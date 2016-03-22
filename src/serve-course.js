'use strict';

const assert = require('assert');
const http = require('http');
const path = require('path');

const async = require('async');
const body_parser = require('body-parser');
const cookie_parser = require('cookie-parser');
const csv = require('csv');
const express = require('express');
const response_time = require('response-time');

const logger = require('./logger');
const omnivore = require('./omnivore');

const x_auth_user = exports.x_auth_user = 'X-Authenticated-User';
const x_omni_sign = exports.x_omni_sign = 'X-Omnivore-Signed';

// create a web frontend for an Omnivore backend
exports.createApp = function createApp(omni) {
  
  let log = logger.log.child({ in: 'server', course: omni.course });
  
  let app = express();
  
  app.set('strict routing', true);
  app.set('trust proxy', 'loopback');
  app.set('view engine', 'jade');
  app.set('x-powered-by', false);
  
  app.locals.path = path;
  app.locals.types = omnivore.types;
  
  app.use(response_time());
  app.use(logger.express(log));
  
  app.param('username', (req, res, next, username) => {
    if ( ! omnivore.types.is(username, 'username')) { return next('route'); }
    res.locals.username = username;
    next();
  });
  
  app.param('key', (req, res, next, key) => {
    key = '/' + key;
    if ( ! omnivore.types.is(key, 'key_path')) { return next('route'); }
    res.locals.key = req.params.key = key;
    next();
  });
  
  app.param('keys', (req, res, next, keys) => {
    keys = ('/' + keys).split(',');
    if ( ! keys.every(key => omnivore.types.is(key, 'key_path'))) { return next('route'); }
    req.params.keys = keys;
    next();
  });
  
  app.locals.course = omni.course;
  
  // API
  
  let api = express.Router();
  
  api.post('*', body_parser.text({ type: 'application/json' }), (req, res, next) => {
    let signed = req.header(x_omni_sign).split(' ');
    omni.parse(signed[0], signed[1], req.body, (err, parsed) => {
      if (err) {
        log.warn(err, 'api parse error');
        return res.status(403).end();
      }
      res.locals.authagent = signed[0];
      req.body = parsed;
      next();
    });
  });
  
  api.post('/multiadd', (req, res, next) => {
    omni.multiadd(res.locals.authagent, req.body, err => {
      if (err) { return next(err); }
      res.end();
    });
  });
  
  api.all('*', (req, res) => res.status(404).end());
  
  api.use((err, req, res, next) => {
    log.error({ err }, 'api error');
    res.status(500).end();
  });
  
  app.use('/api/v2', api);
  
  // web
  
  app.use(cookie_parser());
  
  // ...
  
  app.all('*', (req, res, next) => {
    // authentication
    let authuser = res.locals.authuser = req.header(x_auth_user);
    if ( ! authuser) { return next(`missing ${x_auth_user} header`); }
    res.set(x_auth_user, authuser);
    omni.memo.staff((err, staff) => {
      if (err) { return next(err); }
      res.locals.authstaff = staff.has(authuser);
      next();
    });
  });
  
  app.get('*', (req, res, next) => {
    res.set('Content-Security-Policy',
            "default-src 'self' https://*.googleapis.com https://*.gstatic.com https://*.bootstrapcdn.com");
    next();
  });
  
  app.get('/', (req, res) => res.render('course'));
  
  function authorize(req, res, next) {
    if (req.params.username !== res.locals.authuser) {
      if ( ! res.locals.authstaff) { return res.render('401', { error: 'permission denied' }); }
    }
    next();
  }
  
  app.get('/u/:username/:key(*)', authorize, (req, res, next) => {
    let spec = {
      username: req.params.username,
      key: req.params.key,
      hidden: res.locals.authstaff,
    };
    omni.get(spec, (err, grades) => {
      if (err) { return next(err); }
      if (grades.length) {
        async.auto({
          grade: cb => cb(null, grades[0]),
          inputs: cb => omni.inputs(spec, cb),
          outputs: cb => omni.outputs(spec, cb),
        }, (err, results) => {
          if (err) { return next(err); }
          if ( ! results.grade.visible) { res.locals.staffpage = true; }
          res.render('user-grade', results);
        });
      } else {
        async.auto({
          dirs: cb => omni.dirs(spec, cb),
          children: cb => omni.children(spec, cb),
        }, (err, results) => {
          if (err) { return next(err); }
          res.render('user-dir', results);
        });
      }
    });
  });
  app.get('/u/:username/:key(*).history', authorize, (req, res, next) => {
    let spec = {
      username: req.params.username,
      key: req.params.key,
      hidden: res.locals.authstaff,
    };
    omni.get(spec, (err, grades) => {
      if (err) { return next(err); }
      if (grades.length) {
        async.auto({
          grade: cb => cb(null, grades[0]),
          history: cb => omni.history(spec, cb),
        }, (err, results) => {
          if (err) { return next(err); }
          if ( ! results.grade.visible) { res.locals.staffpage = true; }
          res.render('user-grade', results);
        });
      } else {
        res.status(404).render('404');
      }
    });
  });
  app.get('/u/:username/:key(*)/', authorize, (req, res, next) => res.redirect(301, `/${omni.course}${req.path.slice(0, -1)}`));
  app.get('/u/:username', (req, res, next) => res.redirect(301, `/${omni.course}${req.path}/`));
  app.get('/user/*', (req, res, next) => res.redirect(301, `/${omni.course}${req.path.replace('/user', '/u/' + res.locals.authuser)}`));
  app.get('/user', (req, res, next) => res.redirect(301, `/${omni.course}${req.path}/`));
  
  function staffonly(req, res, next) {
    if ( ! res.locals.authstaff) { return res.render('401', { error: 'permission denied' }); }
    res.locals.staffpage = true;
    next();
  }
  
  app.get('/grades/:key(*)', staffonly, (req, res, next) => {
    let spec = { key: req.params.key, hidden: true };
    omni.get(spec, (err, grades) => {
      if (err) { return next(err); }
      if (grades.length) {
        async.auto({
          grades: cb => cb(null, grades),
        }, (err, results) => {
          if (err) { return next(err); }
          res.render('staff-grades', results);
        });
      } else {
        async.auto({
          dirs: cb => omni.dirs(spec, cb),
          children: cb => omni.leaves(spec, cb),
        }, (err, results) => {
          if (err) { return next(err); }
          res.render('staff-dir', results);
        });
      }
    });
  });
  app.get('/grades/:key(*)/', authorize, (req, res, next) => res.redirect(301, `/${omni.course}${req.path.slice(0, -1)}`));
  
  app.get('/grades/:keys(*).csv', authorize, (req, res, next) => {
    let prefix = omnivore.types.common(req.params.keys).slice(1);
    let filename = `${omni.course}-${prefix || 'grades'}.csv`.replace(/\//g, '-');
    let spec = { hidden: true };
    omni.multiget(req.params.keys, spec, (err, rows) => {
      if (err) { return next(err); }
      res.attachment(filename);
      let sheet = csv.stringify({ quotedString: true });
      sheet.pipe(res);
      sheet.write([ 'username', ...req.params.keys, `exported ${new Date().toISOString()} by ${res.locals.authuser}` ]);
      for (let row of rows) {
        sheet.write([ row.username, ...req.params.keys.map(key => row[key].value) ]);
      }
      sheet.end();
    });
  });
  
  app.get('/users/', staffonly, (req, res, next) => {
    omni.users((err, users) => {
      if (err) { return next(err); }
      res.render('staff-users', { users });
    });
  });
  app.get('/users', (req, res, next) => res.redirect(301, `/${omni.course}${req.path}/`));
  
  app.all('*', (req, res) => res.status(404).render('404'));
  
  app.use((err, req, res, next) => {
    log.error({ err }, 'app error');
    res.status(500).render('500');
  });
  
  return app;
};

// start web frontend for course
if (require.main === module) {
  
  // we must be a child process
  assert(process.send, 'not a child process');
  
  // we must have a valid course
  let course = process.argv[2];
  assert(omnivore.types.is(course, 'course'), 'invalid course');
  
  let log = logger.log.child({ in: 'serve-course', course });
  
  process.on('uncaughtException', err => {
    try { log.error({ err }, 'uncaught exception'); } catch (err) { console.error(err); }
    process.exit(1);
  });
  
  let omni = new omnivore.Omnivore(course);
  
  setInterval(() => {
    omni.cron(err => { if (err) { log.error({ err }, 'cron'); } });
  }, 1000 * 60 * 60);
  
  let server = http.createServer(exports.createApp(omni));
  server.timeout = 0;
  
  async.parallel([
    cb => omni.once('ready', cb),
    cb => server.listen(0, 'localhost', cb),
  ], () => {
    log.info({ course, address: server.address() }, 'listening');
    process.send({ port: server.address().port });
  });
  
  // XXX kill self after timeout, but only when there are no requests in flight!
}
