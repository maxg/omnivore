'use strict';

const assert = require('assert');
const crypto = require('crypto');
const events = require('events');
const fs = require('fs');
const path = require('path');
const util = require('util');

const async = require('async');
const minimatch = require('minimatch');
const sqlite3 = require('sqlite3'); //.verbose(); // XXX
const xtype = require('xtypejs');

const config = require('../config');
const log = require('./logger').cat('omnivore');

const course_regex = exports.course_regex = /^[A-Z0-9]+\.[A-Z0-9]+\/(fa|ia|sp|su)\d\d$/;
const agent_regex = exports.agent_regex = /^!?\w+$/;
const user_regex = exports.user_regex = /^\w+$/;
const key_regex = exports.key_regex = /^(\/|(\/[\w-]+)+)$/;
const pattern_regex = exports.pattern_regex = /^(\/([\w-]+|\*))+$/;
const timestamp_regex = exports.timestamp_regex = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{3})?Z$/;

const signature_algorithm = exports.signature_algorithm = 'RSA-SHA256';
const signature_encoding = exports.signature_encoding = 'base64';

exports.instance = function instance(course) {
  assert(xtype.isString(course) && course_regex.test(course));
  let setup = require(path.join(config.course_dir, course, 'setup.js'));
  let db = path.join(config.data_dir, course, 'grades.sqlite');
  return new Omnivore(setup, db);
}

const Omnivore = exports.Omnivore = function Omnivore(setup, db) {
  assert(xtype.isObject(setup));
  assert(xtype.isString(db) && (db === ':memory:' || fs.statSync(path.dirname(db)).isDirectory()));
  
  let self = this;
  events.EventEmitter.call(this);
  
  this.setup = {};
  
  for (let prop of [ 'agents', 'computed', 'dates', 'reports', 'staff' ]) {
    Object.defineProperty(this.setup, prop, { get: () => setup[prop] || [] });
  }
  
  for (let spec of this.setup.dates) {
    for (let date of [ 'visible', 'active', 'due' ]) {
      if (spec[date]) { spec[date] = new Date(spec[date]); }
    }
  }
  
  this.db = new sqlite3.Database(db);
  
  this.db.on('open', this.emit.bind(this, 'open'));
  this.db.on('close', this.emit.bind(this, 'close'));
  this.db.on('error', this.emit.bind(this, 'error'));
  //this.db.on('trace', sql => console.log(sql));
  //this.db.on('profile', (sql, ms) => {
  //  if (ms < 100) { return; }
  //  log.info({ sql: sql, ms: ms }, 'profile');
  //  self.db.all('EXPLAIN QUERY PLAN ' + sql, (err, rows) => {
  //    log.info({ sql: sql, plan: rows.map(row => row.detail) }, 'query plan');
  //  });
  //});
  
  let handleError = err => { if (err) { self.emit('error', err); } };
  let prepare = sql => self.db.prepare(sql, handleError);
  
  this.db.serialize(); // XXX remove me
  
  this.db.exec(config.db_schema, handleError);
  
  this.statements = {
    
    select: {
      key: prepare('SELECT * FROM keys WHERE key = $key'),
      info: prepare('SELECT * FROM keyinfo WHERE ($key IS NULL OR key = $key)'),
      infoChildren: prepare('SELECT * FROM keyinfo WHERE parent = $key AND key != "/"'),
      infoOutputs: prepare('SELECT * FROM keyinfo WHERE key IN (SELECT output FROM dataflow WHERE input = $key)'),
      infoInputs: prepare('SELECT * FROM keyinfo WHERE key IN (SELECT input FROM dataflow WHERE output = $key)'),
      userGrade: prepare(config.db_select.grade),
      grades: prepare('SELECT * FROM grades WHERE ($user IS NULL OR user = $user) AND key = $key'),
      gradeChildren: prepare('SELECT * FROM grades WHERE ($user IS NULL OR user = $user) AND parent = $key'),
      gradeOutputs: prepare('SELECT * FROM grades WHERE ($user IS NULL OR user = $user) ' +
                            'AND key IN (SELECT output FROM dataflow JOIN active ON (input = key) WHERE input = $key)'),
      userGradeInputs: prepare(config.db_select.inputs),
      gradeInputs: prepare('SELECT * FROM grades NATURAL JOIN active WHERE ($user IS NULL OR user = $user) ' +
                           'AND key IN (SELECT input FROM dataflow WHERE output = $key)'),
      history: prepare('SELECT * FROM history WHERE ($user IS NULL OR user = $user) AND key = $key'),
    },
    
    insert: {
      key: prepare('INSERT OR IGNORE INTO keys (key, parent) VALUES ($key, $parent)'),
      active: prepare('INSERT OR IGNORE INTO active VALUES ($key)'),
      visible: prepare('INSERT OR IGNORE INTO visible VALUES ($key)'),
      rank: prepare('INSERT OR REPLACE INTO ranks VALUES ($key, $rank)'),
      deadline: prepare('INSERT OR REPLACE INTO deadlines (key, due) VALUES ($key, datetime($due))'),
      dataflow: prepare('INSERT OR IGNORE INTO dataflow (output, input) VALUES ($output, $input)'),
      data: prepare('INSERT OR REPLACE INTO all_data (user, key, ts, type, value, agent) ' +
                    'VALUES ($user, $key, datetime($ts), $type, $value, $agent)'),
      computed: prepare('INSERT OR REPLACE INTO all_computed (user, key, ts, type, value) ' +
                        'VALUES ($user, $key, datetime("now"), $type, $value)'),
    },
  };
  
  this.atoms = async.queue((fn, cb) => fn(cb));
  
  this._setupKey(null, handleError);
  
  for (let spec of self.setup.reports) {
    spec.order.forEach((child, idx) => {
      let key = spec.in + '/' + child;
      async.series([
        cb => self._addKey(key, cb),
        cb => self.statements.insert.rank.run({ $key: spec.in + '/' + child, $rank: idx }, cb),
      ], handleError);
    });
  }
}
util.inherits(Omnivore, events.EventEmitter);

function exclusive(fn) {
  return function() {
    // run the original function on the transaction queue & intercede in callback chain
    let self = this;
    let args = Array.prototype.slice.call(arguments, 0, arguments.length-1);
    let cb = arguments[arguments.length-1];
    assert(xtype.isFunction(cb));
    this.atoms.push(done => fn.apply(self, args.concat(function() {
      done();
      cb.apply(this, arguments);
    })));
  }
}

Omnivore.prototype.close = exclusive(Omnivore.prototype._close = function _close(callback) {
  log.info('close');
  assert(xtype.isFunction(callback));
  
  this.db.close(callback);
})

Omnivore.prototype._setupKey = function _setupKey(key, callback) {
  assert(xtype.isNull(key) || (xtype.isString(key) && key_regex.test(key)));
  assert(xtype.isFunction(callback));
  
  let tasks = [];
  
  let self = this;
  self.statements.select.info.each({ $key: key }, (err, row) => {
    row = sqliteToRowSync(row);
    
    for (let spec of self.setup.dates) {
      if ( ! minimatch(row.key, spec.keys)) { continue; }
      
      if (spec.due && ((row.due && row.due.valueOf()) !== spec.due.valueOf())) {
        tasks.push(cb => self.statements.insert.deadline.run({ $key: row.key, $due: spec.due.toISOString() }, cb));
      }
      
      for (let flag of [ 'active', 'visible' ]) {
        if (spec[flag] && spec[flag].valueOf() <= new Date().valueOf() && ! row[flag]) {
          tasks.push(cb => self.statements.insert[flag].run({ $key: row.key }, cb));
        }
      }
    }
    
    tasks.push(cb => self._addDataflow(row.key, cb));
  }, () => async.series(tasks, callback));
}

Omnivore.prototype._addKey = function _addKey(key, callback) {
  assert(xtype.isString(key) && key_regex.test(key));
  assert(xtype.isFunction(callback));
  
  let self = this;
  self.statements.select.key.get({ $key: key }, (err, row) => {
    if (row) { return callback(); }
    
    let parent = '';
    let tasks = [];
    for (let component of key.split('/').slice(1)) {
      tasks.push(cb => self.statements.insert.key.run({
        $parent: parent || '/',
        $key: parent += '/' + component,
      }, cb));
    }
    
    tasks.push(cb => self._setupKey(key, cb));
    
    async.series(tasks, err => callback(err));
  });
}

function matching(key, glob) {
  assert(xtype.isString(key) && key_regex.test(key));
  assert(xtype.isString(glob) && pattern_regex.test(key));
  
  return new RegExp(minimatch.makeRe(glob).source.replace(/\$$/,'')).exec(key)[0];
}

Omnivore.prototype._addDataflow = function _addDataflow(key, callback) {
  assert(xtype.isString(key) && key_regex.test(key));
  assert(xtype.isFunction(callback));
  
  let params = [];
  for (let computed of this.setup.computed) {
    for (let from of computed.from) {
      if (minimatch(key, computed.in + from)) {
        params.push({ $output: matching(key, computed.in) + computed.compute, $input: key });
      }
    }
  }
  let self = this;
  async.series(
    params.map(param => cb => self._addKey(param.$output, cb))
    .concat(params.map(param => cb => self.statements.insert.dataflow.run(param, cb)))
    .concat(params.map(param => cb => self._addDataflow(param.$output, cb))),
    callback);
}

Omnivore.prototype.parse = function(agent, signature, json, callback) {
  log.info({ agent: agent }, 'parse');
  assert(xtype.isString(agent) && agent_regex.test(agent));
  assert(xtype.isString(signature));
  assert(xtype.isString(json));
  assert(xtype.isFunction(callback));
  
  agent = this.setup.agents[agent];
  if ( ! agent) { return callback('unknown agent'); }
  
  // XXX no, agents should be specified in setup file
  let verify = crypto.createVerify(signature_algorithm);
  verify.end(json, 'utf8');
  let valid = verify.verify(agent.public, signature, signature_encoding);
  if ( ! valid) { return callback('invalid signature'); }
  
  let data = JSON.parse(json, (key, value) => {
    if (key === 'ts') {
      assert(xtype.isString(value) && timestamp_regex.test(value));
      return new Date(value);
    }
    return value;
  });
  callback(null, data);
}

Omnivore.prototype.add = exclusive(Omnivore.prototype._add = function _add(agent, user, key, ts, value, callback) {
  log.info({ agent: agent, user: user, key: key }, 'add');
  assert(xtype.isString(agent) && agent_regex.test(agent));
  assert(xtype.isString(user) && user_regex.test(user));
  assert(xtype.isString(key) && key_regex.test(key));
  assert(xtype.isDate(ts));
  assert(xtype.isNumber(value) || xtype.isString(value) || xtype.isBoolean(value));
  assert(xtype.isFunction(callback));
  
  // TODO agent permission
  
  let self = this;
  async.series([
    cb => self._addKey(key, cb),
    cb => self._addDataflow(key, cb),
    cb => self.statements.insert.data.run({
      $user: user,
      $key: key,
      $ts: ts.toISOString(),
      $type: xtype.type(value),
      $value: value,
      $agent: agent,
    }, cb),
  ], err => callback(err));
})

Omnivore.prototype.multiadd = exclusive(Omnivore.prototype._multiadd = function _multiadd(agent, entries, callback) {
  log.info({ agent: agent }, 'multiadd');
  assert(xtype.isString(agent) && agent_regex.test(agent));
  assert(xtype.isArray(entries) && xtype.all.isObject(entries));
  assert(xtype.isFunction(callback));
  
  let self = this;
  async.series([
    cb => self.db.run('BEGIN IMMEDIATE TRANSACTION', cb),
    cb => async.eachSeries(entries, (entry, cb) => {
      self._add(agent, entry.user, entry.key, entry.ts, entry.value, cb);
    }, cb),
  ], err => {
    self.db.run(err ? 'ROLLBACK TRANSACTION' : 'COMMIT TRANSACTION');
    // XXX what if that failed?
    callback(err);
  });
})

Omnivore.prototype.dir = function dir(key, callback) {
  log.info({ key: key }, 'dir');
  assert(xtype.isString(key) && key_regex.test(key));
  assert(xtype.isFunction(callback));
  
  let self = this;
  async.waterfall([
    cb => self.statements.select.infoChildren.all({ $key: key }, cb),
    (rows, cb) => async.map(rows, sqliteToRow, cb),
  ], callback);
}

Omnivore.prototype.info = function info(spec, callback) {
  log.info({ spec: spec }, 'info');
  assert(xtype.isSinglePropObject(spec));
  assert(xtype.isFunction(callback));
  
  let statement;
  if (spec.key) {
    statement = this.statements.select.info;
  } else if (spec.input) {
    statement = this.statements.select.infoOutputs;
  } else if (spec.output) {
    statement = this.statements.select.infoInputs;
  } else if (spec.all) {
    statement = this.statements.select.info;
  } else {
    assert(false);
  }
  let key = spec.key || spec.input || spec.output || null;
  assert(xtype.isNull(key) || (xtype.isString(key) && key_regex.test(key)));
  
  let self = this;
  async.waterfall([
    cb => statement.all({ $key: key }, cb),
    (rows, cb) => async.map(rows, sqliteToRow, cb),
  ], callback);
}

Omnivore.prototype.get = exclusive(Omnivore.prototype._get = function _get(user, spec, callback) {
  log.info({ user: user, spec: spec }, 'get');
  assert(xtype.isNull(user) || (xtype.isString(user) && user_regex.test(user)));
  assert(xtype.isSinglePropObject(spec));
  assert(xtype.isFunction(callback));
  
  let statement;
  if (spec.key) {
    statement = user ? this.statements.select.userGrade : this.statements.select.grades;
  } else if (spec.parent) {
    statement = this.statements.select.gradeChildren;
  } else if (spec.input) {
    statement = this.statements.select.gradeOutputs;
  } else if (spec.output) {
    statement = user ? this.statements.select.userGradeInputs : this.statements.select.gradeInputs;
  } else if (spec.history) {
    statement = this.statements.select.history;
  } else {
    assert(false);
  }
  let key = spec.key || spec.parent || spec.input || spec.output || spec.history;
  assert(xtype.isString(key) && key_regex.test(key));
  
  let self = this;
  statement.all({ $user: user, $key: key }, (err, rows) => {
    if (err) { return callback(err); }
    self._compute(rows.map(sqliteToRowSync), callback);
  });
})

Omnivore.prototype._compute = function _compute(rows, callback) {
  assert(xtype.isArray(rows) && xtype.all.isObject(rows));
  assert(xtype.isFunction(callback));
  
  let self = this;
  async.mapSeries(rows, (row, cb) => { // XXX map
    if ( ! (row.value === null && row.compute)) {
      return cb(null, row);
    }
    async.waterfall([
      cb => self._get(row.user, { output: row.key }, cb),
      (rows, cb) => self._evaluate(row, rows, cb),
      (value, cb) => self.statements.insert.computed.run({
        $user: row.user,
        $key: row.key,
        $type: xtype.type(value),
        $value: value,
      }, cb),
      cb => self.statements.select.userGrade.get({
        $user: row.user,
        $key: row.key,
      }, cb),
      sqliteToRow,
    ], cb);
  }, callback);
}

Omnivore.prototype._evaluate = function _evaluate(output, inputs, callback) {
  log.info({ output: output }, '_evaluate');
  assert(xtype.isObject(output));
  assert(xtype.isArray(inputs) && xtype.all.isObject(inputs));
  assert(xtype.isFunction(callback));
  
  if (inputs.length === 0) {
    return callback(null, 0);
  }
  
  let computed = this.setup.computed.find(
    computed => minimatch(output.key, computed.in + computed.compute));
  let rows = {};
  let args = computed.from.map(from => {
    rows[from] = inputs.filter(input => minimatch(input.key, computed.in + from));
    let vals = rows[from].map(input => input.value);
    if (from.indexOf('*') >= 0) { return vals; }
    assert(vals.length <= 1);
    return vals[0];
  });
  let context = {
    rows: rows,
    sum: arr => Array.prototype.slice.call(arr).reduce((a, b) => a + b, 0),
  };
  let value = computed.as.apply(context, args);
  
  return callback(null, value);
}

Omnivore.prototype.multiget = exclusive(Omnivore.prototype._multiget = function _multiget(user, spec, callback) {
  log.info({ user: user, spec: spec }, 'multiget');
  assert(xtype.isNull(user) || (xtype.isString(user) && user_regex.test(user)));
  assert(xtype.isSinglePropObject(spec));
  assert(xtype.isArray(spec.keys));
  assert(xtype.isFunction(callback));
  
  let results = [];
  let users = {};
  
  let self = this;
  async.eachSeries(spec.keys, (key, cb) => {
    self._get(user, { key: key }, (err, rows) => {
      if (err) { return cb(err); }
      for (let row of rows) {
        if ( ! users[row.user]) { results.push(users[row.user] = { user: row.user }); }
        users[row.user][key] = row;
      }
      cb();
    });
  }, err => callback(err, results));
})

let sqliteToRow = async.asyncify(sqliteToRowSync);
function sqliteToRowSync(row) {
  assert(xtype.isObject(row));
  
  if (row.hasOwnProperty('value')) {
    switch (row.type) {
      case null:
        assert(row.value === null);
        break;
      case 'string':
        break;
      case 'number':
        row.value = parseFloat(row.value);
        break;
      case 'boolean':
        assert(row.value === 0 || row.value === 1);
        row.value = row.value === 1;
        break;
    }
  }
  for (let date of [ 'due', 'ts' ]) {
    if (row.hasOwnProperty(date)) { row[date] = sqliteToDate(row[date]); }
  }
  for (let bool of [ 'active', 'children', 'compute', 'computed', 'leaf', 'visible' ]) {
    if (row.hasOwnProperty(bool)) { row[bool] = row[bool] === 1; }
  }
  
  return row;
}

function sqliteToDate(ts) {
  assert(xtype.isNull(ts) || xtype.isString(ts));
  
  if (ts === null) { return ts; }
  return new Date(ts.replace(/ /, 'T') + 'Z');
}

exports.toCSV = function toCSV(value) {
  switch (xtype.type(value)) {
    case 'null':
    case 'string':
    case 'number': return value;
    case 'boolean': return { toJSON: () => value };
    default: assert(false);
  }
}

exports.fromCSV = function fromCSV(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}
