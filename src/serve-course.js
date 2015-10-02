'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

const async = require('async');
const bodyparser = require('body-parser');
const csv = require('csv');
const express = require('express');
const multer = require('multer');

const logger = require('./logger');
const log = logger.cat('frontend');
const omnivore = require('./omnivore');

const x_auth_user = 'X-Authenticated-User';

process.on('uncaughtException', function uncaughtException(err) {
  console.error(err.stack);
  try { log.error(err, 'uncaught exception'); } catch (err) { console.error(err); }
  process.exit(1);
});

// we must be a child process
assert(process.send);
// we must have a valid course
const course = process.argv[2];
assert(omnivore.course_regex.test(course));

const omni = omnivore.instance(course);

const app = express();

app.set('trust proxy', 'loopback');
app.set('view engine', 'jade');
app.set('x-powered-by', false);

app.locals.path = path;

app.use(logger.express());

app.param('username', function(req, res, next, username) {
  if ( ! omnivore.user_regex.test(username)) { return next('route'); }
  res.locals.username = username;
  next();
});

app.param('key', function(req, res, next, key) {
  key = '/' + key;
  if ( ! omnivore.key_regex.test(key)) { return next('route'); }
  res.locals.key = req.params.key = key;
  next();
});

app.param('keys', function(req, res, next, keys) {
  keys = keys.split(';');
  let key = '/' + keys.shift();
  let subkeys = keys.map(subkey => (key === '/' ? '' : key) + '/' + subkey);
  if ( ! omnivore.key_regex.test(key)) { return next('route'); }
  for (let subkey of subkeys) {
    if ( ! omnivore.key_regex.test(subkey)) { return next('route'); }
  }
  req.params.key = key;
  req.params.subkeys = subkeys;
  next();
});

app.locals.course = course;

// API

let api = express.Router();

api.post('*', bodyparser.text({ type: 'application/json' }), function signed(req, res, next) {
  let signed = req.header('X-Omnivore-Signed').split(' ');
  omni.parse(signed[0], signed[1], req.body, (err, parsed) => {
    if (err) { return res.status(403).end(); }
    res.locals.authagent = '!' + signed[0];
    req.body = parsed;
    next();
  });
});

api.post('/add', function post_grades(req, res, next) {
  omni.multiadd(res.locals.authagent, req.body, err => {
    if (err) { return res.status(500).end(); }
    res.end();
  })
});

api.all('*', notfound);

app.use('/api/v1', api);

// web

app.use(require('cookie-parser')());

function authorize(req, res, next) {
  if (req.params.username !== res.locals.authuser) {
    if ( ! res.locals.authstaff) { return res.render('401'); }
  }
  res.locals.staffpage = res.locals.sudo;
  next();
}

function staffonly(req, res, next) {
  if ( ! res.locals.authstaff) { return res.render('401'); }
  res.locals.staffpage = true;
  next();
}

function keyinfo(req, res, next) {
  omni.info({ key: req.params.key }, (err, infos) => {
    res.locals.keyinfo = infos[0];
    if ( ! res.locals.keyinfo) { return res.render('404'); }
    next(err);
  });
}

function saferender(req, res, next, tasks, template) {
  async.auto(tasks, (err, results) => {
    if (err) { return next(err); }
    if ( ! res.locals.staffpage) {
      for (let result of Object.keys(results)) {
        results[result] = results[result].filter(row => row.visible === true || row.leaf === false);
      }
    }
    res.render(template, results);
  });
}

app.all('*', function authenticate(req, res, next) {
  let authuser = res.locals.authuser = req.header(x_auth_user); // XXX not safe vs. other processes on machine!
  assert(authuser);
  res.set(x_auth_user, authuser);
  res.locals.authstaff = omni.setup.staff.indexOf(authuser) >= 0;
  res.locals.sudo = res.locals.authstaff && req.cookies.sudo === 'true';
  next();
});

app.get('*', function csp(req, res, next) {
  res.set('Content-Security-Policy',
          "default-src 'self' https://*.googleapis.com https://*.gstatic.com https://*.bootstrapcdn.com");
  next();
});

app.get('/', function get_root(req, res, next) {
  res.render('course');
});

app.get('/u/:username/:key(*)', authorize, keyinfo, function get_user(req, res, next) {
  if (res.locals.keyinfo.leaf) {
    saferender(req, res, next, {
      grades: cb => omni.get(req.params.username, { key: req.params.key }, cb),
      history: cb => omni.get(req.params.username, { history: req.params.key }, cb),
      inputs: cb => omni.get(req.params.username, { output: req.params.key }, cb),
      outputs: cb => omni.get(req.params.username, { input: req.params.key }, cb),
    }, 'user-grades');
  } else {
    saferender(req, res, next, {
      dirs: cb => omni.dir(req.params.key, cb),
      children: cb => omni.get(req.params.username, { parent: req.params.key }, cb),
    }, 'user-dirs');
  }
});
app.get('/u/:username', (req, res, next) => res.redirect(301, '/' + course + req.path + '/'));
app.get('/user/*', (req, res, next) => res.redirect(301, '/' + course + req.path.replace('/user', '/u/' + res.locals.authuser)));
app.get('/user', (req, res, next) => res.redirect(301, '/' + course + req.path + '/'));

app.get('/grades/:key(*)', staffonly, keyinfo, function get_grades(req, res, next) {
  if (res.locals.keyinfo.leaf) {
    saferender(req, res, next, {
      grades: cb => omni.get(null, { key: req.params.key }, cb),
      inputs: cb => omni.info({ output: req.params.key }, cb),
      outputs: cb => omni.info({ input: req.params.key }, cb),
    }, 'all-grades');
  } else {
    saferender(req, res, next, {
      dirs: cb => omni.dir(req.params.key, cb),
    }, 'all-dirs');
  }
});

app.get('/grades.csv/:keys(*)', staffonly, function get_csv(req, res, next) {
  omni.multiget(null, { keys: req.params.subkeys }, (err, rows) => {
    if (err) { return next(err); }
    
    res.set('Content-Type', 'text/csv');
    let sheet = csv.stringify({ quotedString: true });
    sheet.pipe(res);
    sheet.write([ '', req.params.key, 'exported', new Date().toISOString(), res.locals.authuser ]);
    sheet.write([ 'username' ].concat(req.params.subkeys.map(subkey => path.relative(req.params.key, subkey))));
    for (let row of rows) {
      sheet.write([ row.user ].concat(req.params.subkeys.map(subkey => row[subkey] && omnivore.toCSV(row[subkey].value))));
    }
    sheet.end();
  });
});

app.post('/grades.csv', staffonly, multer().single('csv'), function post_csv(req, res, next) {
  var sheet = csv.parse({ auto_parse: true });
  let entries = [];
  sheet.once('data', keyrow => sheet.once('data', subkeyrow => sheet.on('data', datarow => {
    let key = keyrow[1];
    let user = datarow[0];
    for (let idx = 1; idx < subkeyrow.length; idx++) {
      entries.push({
        user: user,
        key: path.resolve(key, subkeyrow[idx]),
        ts: new Date(),
        value: omnivore.fromCSV(datarow[idx])
      });
    }
  })));
  sheet.once('finish', () => {
    omni.multiadd(res.locals.authuser, entries, err => {
      if (err) { return next(err); }
      // XXX TODO render the entries maybe?
      res.redirect('/' + course);
    });
  });
  sheet.end(req.file.buffer);
});

app.all('*', notfound);

function notfound(req, res, next) {
  res.status(404).render('404');
}

app.use(function error(err, req, res, next) {
  log.error(err, 'app error');
  res.status(500).render('500');
});

const server = http.createServer(app);
server.listen(0, 'localhost', () => {
  log.info({ course: course, address: server.address() }, 'listening');
  process.send({ port: server.address().port });
});
setTimeout(() => {
  log.info({ course: course }, 'will exit');
  process.send({ exit: true });
  log.info({ course: course }, 'exiting');
  server.close(() => omni.close(() => process.exit()));
}, 1000 * 60 * 10); // XXX interval!
