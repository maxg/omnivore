'use strict';

const assert = require('assert');
const http = require('http');
const path = require('path');
const util = require('util');

const async = require('async');
const body_parser = require('body-parser');
const cookie_parser = require('cookie-parser');
const express = require('express');
const multer = require('multer');
const response_time = require('response-time');
const uuidv4 = require('uuid/v4');

const config = require('../config');
const logger = require('./logger');
const notifier = require('./notifier');
const omnivore = require('./omnivore');

const x_auth_user = exports.x_auth_user = 'X-Authenticated-User';
const x_omni_sign = exports.x_omni_sign = 'X-Omnivore-Signed';

const uuid_regex = /\w{8}(-\w{4}){3}-\w{12}/;

// create a web frontend for an Omnivore backend
exports.createApp = function createApp(hosturl, omni) {
  omnivore.types.assert(hosturl, 'string');
  omnivore.types.assert(omni, omnivore.Omnivore);
  
  let log = logger.log.child({ in: 'server', course: omni.course });
  let notify = new notifier.Notifier(hosturl, omni);
  
  let app = express();
  
  app.set('strict routing', true);
  app.set('trust proxy', 'loopback');
  app.set('view engine', 'pug');
  app.set('x-powered-by', false);
  
  app.locals.path = path;
  app.locals.inspect = util.inspect;
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
    res.locals.keys = req.params.keys = keys;
    next();
  });
  
  app.param('query', (req, res, next, query) => {
    query = '/' + query;
    if ( ! omnivore.types.is(query, 'key_path_query')) { return next('route'); }
    res.locals.query = req.params.query = query;
    next();
  });
  
  app.param('queries', (req, res, next, queries) => {
    queries = ('/' + queries).split(',');
    if ( ! queries.every(query => omnivore.types.is(query, 'key_path_query'))) { return next('route'); }
    req.params.queries = queries;
    next();
  });
  
  app.param('upload_id', (req, res, next, id) => {
    if( ! uuid_regex.test(id)) { return next('route'); }
    next();
  });
  
  app.param('stream_id', (req, res, next, id) => {
    if( ! uuid_regex.test(id)) { return next('route'); }
    next();
  });
  
  app.locals.course = omni.course;
  
  // API
  
  let api = express.Router();
  
  api.post('*', body_parser.text({ type: 'application/json' }), (req, res, next) => {
    let signed = req.header(x_omni_sign).split(' ');
    omni.parse(signed[0], signed[1], req.body, (err, parsed) => {
      if (err) {
        log.warn({ err }, 'api parse error');
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
    if ( ! authuser) { return next(new Error(`missing ${x_auth_user} header`)); }
    res.set(x_auth_user, authuser);
    omni.memo.allStaff((err, staff) => {
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
  
  app.get('/', (req, res) => {
    if (res.locals.authstaff) {
      return res.render('course');
    }
    res.redirect(302, `/${omni.course}/u/${res.locals.authuser}/`);
  });
  
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
          grandchildren: cb => omni.grandchildren(spec, cb),
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
  app.get('/u/:username/:key(*)/', (req, res, next) => res.redirect(301, `/${omni.course}${req.path.slice(0, -1)}`));
  app.get('/u/:username', (req, res, next) => res.redirect(301, `/${omni.course}${req.path}/`));
  app.get('/user/*', (req, res, next) => res.redirect(301, `/${omni.course}${req.path.replace('/user', '/u/' + res.locals.authuser)}`));
  app.get('/user', (req, res, next) => res.redirect(301, `/${omni.course}${req.path}/`));
  
  function staffonly(req, res, next) {
    if ( ! res.locals.authstaff) { return res.render('401', { error: 'permission denied' }); }
    res.locals.staffpage = true;
    next();
  }
  
  const pending_streams = new Map();
  
  function create_stream(emitter, template, prefix) {
    let stream_id = uuidv4();
    let results = [];
    let stream = { results, emitter, template };
    pending_streams.set(stream_id, stream);
    emitter.on('rows', post_rows => results.push(...post_rows));
    emitter.on('end', () => {
      delete stream.emitter;
      setTimeout(() => pending_streams.delete(stream_id), 1000 * 10);
    });
    return prefix + stream_id;
  }
  
  function get_stream(req, res, next) {
    res.locals.stream = pending_streams.get(req.params.stream_id);
    if ( ! res.locals.stream) { return res.status(404).end(); }
    next();
  }
  
  app.get('/stream/:stream_id', staffonly, get_stream, (req, res, next) => {
    let { results, emitter, template } = res.locals.stream;
    if ( ! results) { return res.end(); }
    delete res.locals.stream.results;
    res.setHeader('Content-Type', 'text/html');
    let write = rows => res.render(template, { rows }, (err, html) => res.write(html + '\0'));
    write(results);
    if ( ! emitter) { return res.end(); }
    emitter.on('rows', write);
    emitter.on('end', () => res.end());
  });
  
  app.get('/grades/:key(*)', staffonly, (req, res, next) => {
    let spec = { key: req.params.key, hidden: true };
    omni.stream(spec, (err, pre_grades, emitter) => {
      if (err) { return next(err); }
      if (pre_grades.length) {
        let stream_path = emitter && create_stream(emitter, 'staff-grades-rows', `/${omni.course}/stream/`);
        async.auto({
          keys: cb => omni.keys([ req.params.key ], cb),
          rules: cb => omni.rules(req.params.key, cb),
        }, (err, results) => {
          if (err) { return next(err); }
          res.render('staff-grades', {
            pre_grades,
            stream_path,
            keys: results.keys,
            rules: results.rules,
          });
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
  app.get('/grades/:key(*)/', (req, res, next) => res.redirect(301, `/${omni.course}${req.path.slice(0, -1)}`));
  app.get('/grades', (req, res, next) => res.redirect(301, `/${omni.course}${req.path}/`));
  
  app.get('/grades/:keys(*).csv', (req, res, next) => next());
  app.get('/grades/:queries(*).csv', staffonly, (req, res, next) => {
    if (res.locals.keys) { return next(); }
    async.map(req.params.queries, (query, cb) => {
      omni.findKeys(query, { hidden: true }, cb);
    }, (err, rowarrs) => {
      if (err) { return next(err); }
      res.locals.keys = rowarrs.reduce((a, b) => a.concat(b.map(row => row.key)), []).sort();
      next();
    });
  }, (req, res, next) => {
    let prefix = omnivore.types.common(res.locals.keys).slice(1);
    let filename = `${omni.course}-${prefix || 'grades'}.csv`.replace(/\//g, '-');
    let spec = { only_roster: !! req.query.roster, hidden: true };
    omni.multiget(res.locals.keys, spec, (err, rows) => {
      if (err) { return next(err); }
      res.attachment(filename);
      omnivore.csv.stringify(res.locals.keys, rows, [
        `exported ${omnivore.types.dateTimeString(new Date())} by ${res.locals.authuser}`
      ]).pipe(res);
    });
  });
  
  app.get('/grades/:query(*)', staffonly, (req, res, next) => {
    async.auto({
      matches: cb => omni.findKeys(req.params.query, { hidden: true }, cb),
    }, (err, results) => {
      if (err) { return next(err); }
      res.render('staff-keys', results);
    });
  });
  app.get('/grades/:query(*)/', (req, res, next) => res.redirect(301, `/${omni.course}${req.path.slice(0, -1)}`));
  
  const pending_uploads = new Map();
  
  function create_upload(username, data, prefix) {
    let upload_id = uuidv4();
    let timeout = 1000 * 60 * 60 * 24 * 2; // 2 days
    pending_uploads.set(upload_id, {
      username,
      created: new Date(),
      timeout: new Date(Date.now() + timeout),
      data,
      path: prefix + upload_id,
    });
    setTimeout(() => pending_uploads.delete(upload_id), timeout).unref();
    return prefix + upload_id;
  }
  
  function get_upload(req, res, next) {
    res.locals.upload = pending_uploads.get(req.params.upload_id);
    if ( ! res.locals.upload) { return res.status(404).render('404'); }
    next();
  }
  
  app.post('/u/:username/:key(*).history', staffonly, body_parser.urlencoded({ extended: false }), (req, res, next) => {
    let upload_path = create_upload(res.locals.authuser, {
      keys: [ req.params.key ],
      rows: [ {
        username: req.params.username,
        values: [ omnivore.csv.convert(req.body[req.params.key]) ],
      } ],
    }, `/${omni.course}/upload/`);
    res.redirect(303, upload_path);
  });
  
  app.post('/upload.csv', staffonly, multer().single('grades'), (req, res, next) => {
    let input = req.file && req.file.buffer || req.body.gradestext;
    omnivore.csv.parse(input).once('parsed', (keys, rows) => {
      let upload_path = create_upload(res.locals.authuser, { keys, rows }, `/${omni.course}/upload/`);
      res.redirect(303, upload_path);
    });
  });
  
  app.get('/upload/:upload_id', staffonly, get_upload, (req, res, next) => {
    let data = res.locals.upload.data;
    async.auto({
      keys: cb => omni.keys(data.keys, cb),
      users: cb => omni.users(data.rows.map(row => row.username), cb),
    }, (err, results) => {
      if (err) { return next(err); }
      res.locals.fullpage = true;
      res.render('upload-preview', {
        keys: results.keys,
        rows: data.rows.map(row => Object.assign({}, row, results.users.shift())),
      });
    });
  });
  
  app.post('/upload/:upload_id', staffonly, get_upload, (req, res, next) => {
    let data = res.locals.upload.data;
    let valid = data.rows.filter(row => omnivore.types.is(row.username, 'username'));
    let rows = Array.prototype.concat.call(...valid.map(row => data.keys.map((key, idx) => ({
      username: row.username,
      key,
      ts: res.locals.upload.created,
      value: row.values[idx],
    })))).filter(row => omnivore.types.is(row.value, 'value'));
    omni.multiadd(res.locals.authuser, rows, err => {
      if (err) { return next(err); }
      res.locals.upload.saved = new Date();
      notify.added(res.locals.authuser, rows, res.locals.upload);
      res.render('upload-saved', {
        valid: rows.length,
        invalid: data.keys.length * data.rows.length - rows.length,
      });
    });
  });
  
  app.get('/roster/', staffonly, (req, res, next) => {
    omni.allUsers((err, users) => {
      if (err) { return next(err); }
      res.render('roster', { roster: users.filter(row => row.on_roster).map(row => row.username) });
    });
  });
  app.get('/roster', (req, res, next) => res.redirect(301, `/${omni.course}${req.path}/`));
  
  app.post('/roster/', staffonly, body_parser.urlencoded({ extended: false }), (req, res, next) => {
    let upload_path = create_upload(res.locals.authuser, {
      users: req.body.roster.split(/\r?\n/).map(username => username.trim().toLowerCase()).filter(username => username),
    }, `/${omni.course}/roster/`);
    res.redirect(303, upload_path);
  });
  
  app.get('/roster/:upload_id', staffonly, get_upload, (req, res, next) => {
    async.auto({
      users: cb => omni.users(res.locals.upload.data.users, cb),
      allUsers: cb => omni.allUsers(cb),
    }, (err, results) => {
      if (err) { return next(err); }
      let newroster = results.users.filter(row => omnivore.types.is(row.username, 'username')).map(row => row.username);
      let oldroster = results.allUsers.filter(row => row.on_roster).map(row => row.username);
      res.render('roster-preview', {
        users: results.users,
        adding: newroster.filter(username => ! oldroster.includes(username)),
        removing: oldroster.filter(username => ! newroster.includes(username)),
      });
    });
  });
  
  app.post('/roster/:upload_id', staffonly, get_upload, (req, res, next) => {
    let valid = res.locals.upload.data.users.filter(username => omnivore.types.is(username, 'username'));
    omni.setRoster(res.locals.authuser, valid, err => {
      if (err) { return next(err); }
      res.locals.upload.saved = new Date();
      res.redirect(303, `/${omni.course}/users/`);
    });
  });
  
  app.get('/users/', staffonly, (req, res, next) => {
    omni.streamAllUsers((err, pre_users, emitter) => {
      if (err) { return next(err); }
      res.render('staff-users', {
        pre_users,
        stream_path: emitter && create_stream(emitter, 'staff-users-rows', `/${omni.course}/stream/`),
      });
    });
  });
  app.get('/users', (req, res, next) => res.redirect(301, `/${omni.course}${req.path}/`));
  
  app.all('*', (req, res) => res.status(404).render('404'));
  
  app.use((err, req, res, next) => {
    log.error({ err }, 'app error');
    notify.error(err, req, res);
    res.status(500).render('500', { err });
  });
  
  return app;
};

// start web frontend for course
if (require.main === module) {
  
  // we must be a child process
  assert(process.send, 'not a child process');
  
  // we must have a valid URL and course
  let [ hosturl, course, create ] = process.argv.slice(2);
  omnivore.types.assert(hosturl, 'string');
  omnivore.types.assert(course, 'course');
  omnivore.types.assert(create, 'string');
  
  let log = logger.log.child({ in: 'serve-course', course });
  
  process.on('uncaughtException', err => {
    try { log.error({ err }, 'uncaught exception'); } catch (err) { console.error(err); }
    process.exit(1);
  });
  
  let omni = new omnivore.Omnivore(course, config, create === 'true');
  
  setInterval(() => {
    omni.cron(err => { if (err) { log.error({ err }, 'cron'); } });
  }, 1000 * 60 * 10);
  
  let server = http.createServer(exports.createApp(hosturl, omni));
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
