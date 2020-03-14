'use strict';

const assert = require('assert');
const crypto = require('crypto');
const events = require('events');
const fs = require('fs');
const util = require('util');
const vm = require('vm');

const async = require('async');
const memoize = require('memoizee');
const pg = require('pg');

const logger = require('./logger');
const mit_api = require('./mit-api');

const csv = exports.csv = require('./omnivore-csv');
const types = exports.types = require('./omnivore-types');

const db_schema = fs.readFileSync('./config/db-schema.sql', { encoding: 'utf-8' });
const db_intrinsic = fs.readFileSync('./config/db-intrinsic.sql', { encoding: 'utf-8' });
const db_update = fs.readFileSync('./config/db-update.sql', { encoding: 'utf-8' });

const signature_algorithm = exports.signature_algorithm = 'RSA-SHA256';
const signature_encoding = exports.signature_encoding = 'base64';

// create a new Omnivore
//   instance emits 'ready' event when usable
const Omnivore = exports.Omnivore = function Omnivore(course, config, create) {
  types.assert(course, 'course');
  types.assert(config, 'object|undefined');
  types.assert(create, 'boolean|undefined');
  
  events.EventEmitter.call(this);
  
  this.course = course;
  this._config = Object.assign({}, config);
  
  this._log = logger.log.child({ in: 'omnivore', course });
  this._logForTime = ms => {
    return this._log[ms < 50 ? 'debug' : ms < 250 ? 'info' : 'warn'].bind(this._log);
  };
  
  this._pool = new pg.Pool(Object.assign({ database: course }, this._config.db));
  
  this._functions = {
    'intrinsic/userinfo': () => ({}),
  };
  
  if (this._config.mit) {
    let mit = new mit_api.MIT_API(this._config.mit);
    Object.assign(this._functions, {
      'intrinsic/userinfo': ({ async, output: { username } }) => async(cb => mit.person(username, cb)),
    });
  }
  
  async.waterfall([
    cb => cb(null, new pg.Client(Object.assign({ database: 'postgres' }, this._config.db))),
    (client, cb) => client.connect(err => cb(err, client)),
    (client, cb) => {
      this.once('ready', () => client.end());
      client.query({
        text: 'SELECT * FROM pg_catalog.pg_database WHERE datname = $1',
        values: [ course ],
      }, (err, result) => cb(err, client, result));
    },
    (client, result, cb) => {
      if (result.rows.length) { return cb(null, false); }
      if ( ! create) { return cb(new Error(`no course ${course}`)); }
      client.query('CREATE DATABASE "' + course + '"', cb);
    },
    (created, cb) => {
      if (created) {
        this._log.info({ course }, 'initializing');
        return async.series([
          cb => this._pool.query(db_schema, cb),
          cb => this._pool.query(db_intrinsic, cb),
        ], cb);
      }
      cb();
    }
  ], err => {
    if (err) { throw err; }
    this.emit('ready');
  });
  
  this._memo('agent', 'allStaff');
  if (this._config.debug_function_time) {
    this._time(
      '_add', '_multiadd',
      '_get', '_multiget',
      '_children', '_dirs', '_leaves', '_history',
      '_inputs', '_outputs',
      '_current', '_data', '_penalize', '_computed', '_evaluate'
    );
  }
};
util.inherits(Omnivore, events.EventEmitter);

// wrap instance methods to memoize results for a limited time
Omnivore.prototype._memo = function _memo(...methods) {
  this.memo = {};
  for (let method of methods) {
    types.assert(method, 'string');
    types.assert(this[method], 'function');
    
    this.memo[method] = memoize((...args) => this[method](...args), {
      async: true,
      length: false,
      maxAge: 6000, // XXX longer
    });
  }
}

function timed(fn) {
  types.assert(fn, 'function');
  
  let timed = function(...args) {
    let start = +new Date();
    let cb = args.pop();
    types.assert(cb, 'function', 'callback');
    fn.apply(this, [ ...args, (...results) => {
      let finish = +new Date();
      let ms = finish - start;
      this._logForTime(ms)({ fn: timed.name, args: util.inspect(args, { depth: 1, colors: true }), ms });
      cb.apply(this, results);
    } ]);
  };
  Object.defineProperty(timed, 'name', { value: `[t]${fn.name}` });
  return timed;
}

// wrap instance methods to log timing
Omnivore.prototype._time = function _time(...methods) {
  for (let method of methods) {
    types.assert(method, 'string');
    types.assert(this[method], 'function');
    
    this[method] = timed(this[method]);
  }
}

// wrap a function so it runs with a db client
//   fn will receive db client as first arg, must take callback as last arg
function client(fn) {
  types.assert(fn, 'function');
  
  let withClient = function(...args) {
    let cb = args.pop();
    types.assert(cb, 'function', 'callback');
    let self = this;
    
    this._pool.connect((err, client, done) => {
      if (err) { done(err); return cb(err); }
      
      client.inspect = function(depth, opts) { return '[client]'; }
      
      client.logQuery = client.query;
      if (this._config.debug_query_time) {
        client.logQuery = function logQuery(stmt, ...args) {
          let qstart = +new Date();
          let cb = args.pop();
          return client.query(stmt, ...args, (...results) => {
            let qfinish = +new Date();
            let ms = qfinish - qstart;
            self._logForTime(ms)({ query: stmt.name, values: stmt.values, ms });
            cb.apply(this, results);
          });
          return q;
        }
      }
      
      fn.apply(this, [ client, ...args, (...results) => {
        let err = results[0];
        done(err);
        cb.apply(this, results);
      } ]);
    });
  };
  Object.defineProperty(withClient, 'name', { value: `[pg]${fn.name}` });
  return withClient;
}

// wrap a function so it runs in a db transaction
//   fn must take a db client as first arg, callback as last arg
function transaction(fn) {
  types.assert(fn, 'function');
  
  let inTransaction = function(...args) {
    let client = args[0];
    types.assert(client, pg.Client, 'pg.Client');
    let cb = args.pop();
    types.assert(cb, 'function', 'callback');
    
    client.query('BEGIN', txerr => {
      if (txerr) { return cb(txerr); }
      fn.apply(this, [ ...args, (...results) => {
        let err = results[0];
        client.query(err ? 'ROLLBACK' : 'COMMIT', txerr => txerr ? cb(txerr) : cb.apply(this, results));
      } ]);
    });
  };
  Object.defineProperty(inTransaction, 'name', { value: `[tx]${fn.name}` });
  return inTransaction;
}

// obtain a database client
Omnivore.prototype.pg = client(
                        types.check([ pg.Client, 'function', ], [ 'any' ],
                        function _pg(client, fn, done) {
  fn(client, done);
}));

// close the database connection
Omnivore.prototype.close = function(done) { this._pool.end(done); };

Omnivore.prototype.parse = client(
                           types.check([ pg.Client, 'agent', 'string', 'string' ], [ 'row_array' ],
                           Omnivore.prototype._parse = function _parse(client, agent, signature, json, done) {
  async.waterfall([
    cb => client.logQuery({
      name: 'parse-select-agents',
      text: 'SELECT public_key FROM agents WHERE agent = $1',
      values: [ agent ],
    }, cb),
    (result, cb) => result.rows.length ? cb(null, result.rows[0]) : cb('unknown agent'),
    (row, cb) => {
      let verify = crypto.createVerify(signature_algorithm);
      verify.end(json, 'utf8');
      
      let valid = verify.verify(row.public_key, signature, signature_encoding);
      if ( ! valid) { return cb('invalid signature'); }
      
      let data = JSON.parse(json, (key, value) => {
        if (key === 'ts') {
          types.assert(value, 'timestamp');
          return new Date(value);
        }
        return value;
      });
      cb(null, data);
    }
  ], done);
}));

// add a data point
Omnivore.prototype.add = client(transaction(
                         types.translate([ pg.Client, 'agent', 'username', 'key', Date, 'value' ], [ 'any' ],
                         Omnivore.prototype._add = function _add(client, agent, username, key, ts, value, done) {
  //console.log('add', agent, username, key, ts, value);
  
  client.logQuery({
    name: 'add-insert-raw_data',
    text: 'INSERT INTO raw_data (username, key, ts, value, agent) VALUES ($1, $2, $3, $4, $5)',
    values: [ username, key, ts, JSON.stringify(value), agent ],
  }, done);
})));

// add data points
Omnivore.prototype.multiadd = client(transaction(
                              types.translate([ pg.Client, 'agent', 'row_array' ], [ ],
                              Omnivore.prototype._multiadd = function _multiadd(client, agent, entries, done) {
  //console.log('multiadd', agent, entries);
  
  async.eachSeries(entries, (entry, cb) => {
    this._add(client, agent, entry.username, entry.key, entry.ts, entry.value, cb);
  }, done);
})));

// get data points
Omnivore.prototype.get = client(transaction(
                         types.translate([ pg.Client, 'spec' ], [ 'row_array' ],
                         Omnivore.prototype._get = function _get(client, spec, done) {
  //console.log('get', spec);
  
  async.waterfall([
    cb => this._get_grade_rows(client, spec, cb),
    (rows, cb) => this._current(client, rows, cb),
  ], done);
})));

// stream data points
Omnivore.prototype.stream = client(
                            types.translate([ pg.Client, 'spec' ], [ 'row_array', 'object|undefined' ],
                            function _stream(client, spec, done) {
  this._get_grade_rows(client, spec, (err, rows) => {
    if (err) { return done(err); }
    this._stream_current(rows, done);
  });
}));

Omnivore.prototype._get_grade_rows = types.check([ pg.Client, 'spec' ], [ 'array' ],
                                     function _get_grade_rows(client, spec, done) {
  async.waterfall([
    cb => client.logQuery({
      name: 'get-select-grades',
      text: `SELECT * FROM grades
             WHERE ($1 IS NULL OR username = $1) AND (($2 IS NULL AND NOT key ~ '_.*') OR key = $2)
                   AND (visible OR $3)
             ORDER BY username, key`,
      types: [ types.pg.TEXT, types.pg.LTREE, types.pg.BOOL ],
      values: [ spec.username, spec.key, spec.hidden ],
    }, cb),
    (result, cb) => cb(null, result.rows),
  ], done);
});

// get data points
Omnivore.prototype.multiget = client(transaction(
                              types.translate([ pg.Client, 'key_array', 'spec' ], [ 'array' ],
                              Omnivore.prototype._multiget = function _multiget(client, keys, spec, done) {
  async.waterfall([
    cb => client.logQuery({
      name: 'multiget-select-grades',
      text: `SELECT * FROM grades
             WHERE ($1 IS NULL OR username = $1) AND (key ? $2) AND (on_roster OR $3) AND (visible OR $4)
             ORDER BY username, key`,
      types: [ types.pg.TEXT, types.pg.LQUERYarray, types.pg.BOOL ],
      values: [ spec.username, keys, ! spec.only_roster, spec.hidden ],
    }, cb),
    (result, cb) => this._current(client, result.rows, cb),
    (rows, cb) => {
      let results = [];
      let users = {};
      for (let row of rows) {
        if ( ! users[row.username]) {
          results.push(users[row.username] = { username: row.username });
        }
        users[row.username][types.convertOut(row.key, 'key')] = types.convertOut(row, 'row');
      }
      cb(null, results);
    },
  ], done);
})));

// get child data points
Omnivore.prototype.children = client(transaction(
                              types.translate([ pg.Client, 'spec' ], [ 'row_array' ],
                              Omnivore.prototype._children = function _children(client, spec, done) {
  //console.log('children', spec);
  
  async.waterfall([
    cb => client.logQuery({
      name: 'children-select-grades',
      text: `SELECT * FROM grades
             WHERE ($1 IS NULL OR username = $1) AND ($2 IS NULL OR key ~ $3) AND (visible OR $4)
             ORDER BY username, key_order, key`,
      types: [ types.pg.TEXT, types.pg.TEXT, types.pg.LQUERY, types.pg.BOOL ],
      values: [ spec.username, spec.key, spec.key ? `${spec.key}.*{1}` : '*{1}', spec.hidden ],
    }, cb),
    (result, cb) => this._current(client, result.rows, cb),
  ], done);
})));

Omnivore.prototype.grandchildren = client(transaction(
                                   types.translate([ pg.Client, 'spec' ], [ 'row_array' ],
                                   Omnivore.prototype._grandchildren = function _grandchildren(client, spec, done) {
  //console.log('grandchildren', spec);
  
  async.waterfall([
    cb => client.logQuery({
      name: 'grandchildren-select-grades',
      text: `SELECT * FROM grades
             WHERE ($1 IS NULL OR username = $1) AND (visible OR $4)
                   AND (promotion > 0 AND key ~ ($3||'*{2,'||promotion+1||'}')::LQUERY)
             ORDER BY username, subltree(key, 0, nlevel($2)+1), nlevel(key) DESC, key_order, key`,
      types: [ types.pg.TEXT, types.pg.LTREE, types.pg.TEXT, types.pg.BOOL ],
      values: [ spec.username, spec.key, spec.key ? `${spec.key}.` : '', spec.hidden ],
    }, cb),
    (result, cb) => this._current(client, result.rows, cb),
  ], done);
})));

// get subdirectories
Omnivore.prototype.dirs = client(transaction(
                          types.translate([ pg.Client, 'spec' ], [ 'row_array' ],
                          Omnivore.prototype._dirs = function _dirs(client, spec, done) {
  //console.log('dirs', spec);
  
  async.waterfall([
    cb => client.logQuery({
      name: 'dirs-select-keys',
      text: `SELECT DISTINCT subpath(key, 0, nlevel($1) + 1) AS key FROM keys
             WHERE (key ~ $2) AND (visible OR $3)
             ORDER BY key`,
      values: [ spec.key, spec.key ? `${spec.key}.!_.*{1,}` : '!_.*{1,}', spec.hidden ],
    }, cb),
    (result, cb) => cb(null, result.rows),
  ], done);
})));

// get child keys
Omnivore.prototype.leaves = client(transaction(
                            types.translate([ pg.Client, 'spec' ], [ 'row_array' ],
                            Omnivore.prototype._leaves = function _leaves(client, spec, done) {
  // console.log('leaves', spec);
  
  async.waterfall([
    cb => client.logQuery({
      name: 'leaves-select-keys',
      text: `SELECT * FROM keys
             WHERE (key ~ $1) AND (visible OR $2)
             ORDER BY key_order, key`,
      values: [ spec.key ? `${spec.key}.*{1}` : '*{1}', spec.hidden ],
    }, cb),
    (result, cb) => cb(null, result.rows),
  ], done);
})));

// query for keys
Omnivore.prototype.findKeys = client(transaction(
                              types.translate([ pg.Client, 'key_path_query', 'spec' ], [ 'row_array' ],
                              function _findKeys(client, query, spec, done) {
  // console.log('findKeys', query, spec);
  
  async.waterfall([
    cb => client.logQuery({
      name: 'findKeys-select-keys',
      text: `SELECT * FROM keys
             WHERE (key ~ $1) AND (visible OR $2)
             ORDER BY key_order, key`,
      values: [ query, spec.hidden ],
    }, cb),
    (result, cb) => cb(null, result.rows),
  ], done);
})));

// get history
Omnivore.prototype.history = client(transaction(
                             Omnivore.prototype._history_in_tx = types.translate([ pg.Client, 'spec' ], [ 'row_array' ],
                             Omnivore.prototype._history = function _history(client, spec, done) {
  //console.log('history', spec);
  
  async.waterfall([
    cb => client.logQuery({
      name: 'history-select-history',
      text: `SELECT * FROM history
             WHERE ($1 IS NULL OR username = $1) AND ($2 IS NULL OR key = $2) AND (raw OR $3) AND (visible OR $4)
             ORDER BY username, key, created DESC`,
      types: [ types.pg.TEXT, types.pg.LTREE, types.pg.BOOL ],
      values: [ spec.username, spec.key, ! spec.only_raw, spec.hidden ],
    }, cb),
    (result, cb) => cb(null, result.rows),
  ], done);
})));

Omnivore.prototype.inputs = client(transaction(
                            types.translate([ pg.Client, 'spec' ], [ 'row_array' ],
                            Omnivore.prototype._inputs = function _inputs(client, spec, done) {
  //console.log('inputs', spec);
  
  async.waterfall([
    cb => client.logQuery({
      name: 'io-select-grades-inputs',
      text: `SELECT * FROM grades
             WHERE (username = $1) AND (key ? (SELECT inputs FROM computations WHERE output = $2)) AND (visible OR $3)
             ORDER BY username, key`,
      values: [ spec.username, spec.key, spec.hidden ],
    }, cb),
    (result, cb) => this._current(client, result.rows, cb),
  ], done);
})));

Omnivore.prototype.outputs = client(transaction(
                             types.translate([ pg.Client, 'spec' ], [ 'row_array' ],
                             Omnivore.prototype._outputs = function _outputs(client, spec, done) {
  //console.log('outputs', spec);
  
  async.waterfall([
    cb => client.logQuery({
      name: 'io-select-grades-outputs',
      text: `SELECT * FROM grades
             WHERE (username = $1) AND ($2 ? inputs) AND (visible OR $3)
             ORDER BY username, key`,
      types: [ types.pg.TEXT, types.pg.LTREE, types.pg.BOOL ],
      values: [ spec.username, spec.key, spec.hidden ],
    }, cb),
    (result, cb) => this._current(client, result.rows, cb),
  ], done);
})));

Omnivore.prototype._current = types.check([ pg.Client, 'row_array' ], [ 'row_array' ],
                              function _current(client, rows, done) {
  //console.log('current', rows);
  
  async.map(rows, (row, cb) => {
    if (row.created) {
      return cb(null, row);
    }
    if (row.raw_data) {
      return this._data(client, row, cb);
    }
    if (row.output) {
      return this._computed(client, row, cb);
    }
    // no raw data and not a computed value
    return cb(null, row);
  }, done);
});

Omnivore.prototype._stream_current = types.check([ 'row_array' ], [ 'row_array', 'object|undefined' ],
                                     function _stream_current(rows, done) {
  let missing = rows.filter(row => (row.raw_data || row.output) && ! row.created);
  if ( ! missing.length) {
    return done(null, rows, undefined);
  }
  let emitter = new events.EventEmitter();
  done(null, rows, emitter);
  async.eachSeries(missing, (row, cb) => this._emit_current([ row ], emitter, cb), err => {
    if (err) { return emitter.emit('error', err); }
    emitter.emit('end');
  });
});

Omnivore.prototype._emit_current = client(transaction(
                                   types.check([ pg.Client, 'row_array', events.EventEmitter ], [ ],
                                   function _emit_current(client, rows, emitter, done) {
  this._current(client, rows, (err, result) => {
    if (err) { return done(err); }
    emitter.emit('rows', types.convertOut(result, 'row_array'));
    done();
  });
})));

Omnivore.prototype._data = types.check([ pg.Client, 'row' ], [ 'row' ],
                           function _data(client, row, done) {
  //console.log('data', row);
  
  async.waterfall([
    cb => this._getCurrent(client, row, cb),
    (row, cb) => this._penalize(client, row, cb),
    (row, cb) => client.logQuery({
      name: 'data-insert-current_data',
      text: `INSERT INTO current_data (username, key, ts, value, penalty_applied, agent)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING created`,
      values: [ row.username, row.key, row.ts, JSON.stringify(row.value), row.penalty_applied, row.agent ],
    }, (err, result) => cb(err, Object.assign(row, result.rows[0], { computed: false }))),
  ], done);
});

Omnivore.prototype._getCurrent = types.check([ pg.Client, 'row' ], [ 'row' ],
                                 function _getCurrent(client, row, done) {
  //console.log('getCurrent', row);
  
  async.waterfall([
    cb => client.logQuery({
      name: 'getCurrent-select-raw_grades',
      text: `SELECT * FROM raw_grades WHERE username = $1 AND key = $2`,
      values: [ row.username, row.key ],
    }, cb),
    (result, cb) => {
      assert(result.rows.length == 1);
      cb(null, Object.assign({}, row, result.rows[0]));
    },
  ], done);
});

Omnivore.prototype._penalize = types.check([ pg.Client, 'row' ], [ 'row' ],
                               function _penalize(client, row, done) {
  //console.log('penalize', row);
  
  if (( ! row.deadline) || (row.ts <= row.deadline)) {
    return done(null, row);
  }
  
  let fn = this._functions[row.penalize] || this._prepare(row.penalize);
  let context = { args: [ row.deadline, row.ts, row.value ] };
  
  done(null, Object.assign({}, row, {
    value: fn(context),
    penalty_applied: row.penalty_id,
  }));
});

Omnivore.prototype._computed = types.check([ pg.Client, 'row' ], [ 'row' ],
                               function _computed(client, row, done) {
  //console.log('computed', row);
  
  async.waterfall([
    cb => this._getMatches(client, row.username, row.inputs, cb),
    (inputs, cb) => this._evaluate(client, row, inputs, cb),
    (row, cb) => this._penalize(client, row, cb),
    (row, cb) => client.logQuery({
      name: 'computed-insert-current_computed',
      text: `INSERT INTO current_computed (username, key, ts, value, penalty_applied)
             VALUES ($1, $2, $3, $4, $5) RETURNING created`,
      values: [ row.username, row.key, row.ts, JSON.stringify(row.value), row.penalty_applied ],
    }, (err, result) => cb(err, Object.assign(row, result.rows[0], { computed: true }))),
  ], done);
});

Omnivore.prototype._getMatches = types.check([ pg.Client, 'null,username', 'key_array' ], [ 'row_array' ],
                                 function _getMatches(client, username, queries, done) {
  //console.log('getMatches', queries);
  
  async.waterfall([
    cb => client.logQuery({
      name: 'getMatches-select-grades',
      text: `SELECT * FROM
             (SELECT * FROM grades WHERE ($1 IS NULL OR username = $1) AND (key ? $2) AND active) AS grades
             JOIN
             (SELECT * FROM UNNEST($2) WITH ORDINALITY AS query) AS queries ON (key ~ query)
             ORDER BY ordinality, key`,
      types: [ types.pg.TEXT, types.pg.LQUERYarray ],
      values: [ username, queries ],
    }, cb),
    (result, cb) => this._current(client, result.rows, cb),
  ], done);
});

const lquery_ops_regex = /[@*%|!]/;

Omnivore.prototype._evaluate = types.check([ pg.Client, 'row', 'row_array' ], [ 'row' ],
                               function _evaluate(client, output, inputs, done) {
  //console.log('evaluate', output.key, output.inputs, inputs);
  
  let ts = inputs.length ? inputs.map(i => i.ts).reduce((a, b) => a > b ? a : b) : new Date();
  
  let rows = {};
  let args = output.inputs.map(query => {
    let matched = rows[types.convertOut(query, 'key')] = types.convertOut(inputs.filter(input => input.query == query), 'row_array');
    matched.forEach(input => {
      input.raw = done => this._history_in_tx(client, {
        username: input.username, key: input.key, only_raw: true, hidden: true,
      }, done);
    });
    let vals = matched.map(input => input.value);
    if (lquery_ops_regex.test(query)) { return vals; }
    assert(vals.length <= 1);
    return vals[0];
  });
  
  let fn = this._functions[output.compute] || this._prepare(output.compute);
  let complete = (err, value) => done(err, Object.assign({}, output, { ts, value }));
  let context = {
    args,
    rows,
    output: types.convertOut(output, 'row'),
    async: asyncfn => { asyncfn(complete); return complete; },
  };
  
  let result = fn(context);
  if (result !== complete) { complete(null, result); }
});

Omnivore.prototype._prepare = function _prepare(fn) {
  types.assert(fn, 'string');
  
  let script = new vm.Script(`
    (({ args, rows, output, async }) => { delete call; return (${fn})(...args); })(call)
  `, {
    filename: `<${fn}>`,
    timeout: 1500,
  });
  let context = vm.createContext({
    sum: arr => arr.reduce((a, b) => a + b, 0),
    console,
    assert,
    nextTick: process.nextTick,
  });
  return this._functions[fn] = call => {
    assert(context.call === undefined);
    context.call = call;
    return script.runInContext(context);
  };
};

Omnivore.prototype.agent = client(
                           types.check([ pg.Client, 'agent' ], [ 'row' ],
                           function _agent(client, agent, done) {
  client.logQuery({
    name: 'agent-select-agents',
    text: 'SELECT * FROM agents WHERE agent = $1',
    values: [ agent ],
  }, (err, result) => {
    if (err) { return done(err); }
    if ( ! result.rows.length) { return done(new Error('unknown agent')); }
    let row = result.rows[0];
    for (let perm of [ 'add', 'write' ]) {
      row[perm] = row[perm].map(query => types.convertOut(query, 'key'));
    }
    done(null, row);
  });
}));

Omnivore.prototype.allStaff = client(
                              types.check([ pg.Client ], [ Set ],
                              function _staff(client, done) {
  client.logQuery({
    name: 'allStaff-select-staff',
    text: 'SELECT username FROM staff',
  }, (err, result) => {
    if (err) { return done(err); }
    done(null, new Set(result.rows.map(row => row.username)));
  });
}));

Omnivore.prototype.allUsers = client(
                              types.translate([ pg.Client ], [ 'row_array' ],
                              function _allUsers(client, done) {
  async.waterfall([
    cb => this._get_user_rows(client, cb),
    (rows, cb) => this._current(client, rows, cb),
  ], done);
}));

Omnivore.prototype.streamAllUsers = client(
                                    types.translate([ pg.Client ], [ 'row_array', 'object|undefined' ],
                                    function _streamAllUsers(client, done) {
  this._get_user_rows(client, (err, rows) => {
    if (err) { return done(err); }
    this._stream_current(rows, done);
  });
}));

Omnivore.prototype._get_user_rows = types.check([ pg.Client ], [ 'array' ],
                                    function _get_user_rows(client, done) {
  async.waterfall([
    cb => client.logQuery({
      name: 'allUsers-select-users',
      text: `SELECT *, COALESCE(is_on_staff, FALSE) AS on_staff FROM
             (SELECT * FROM grades WHERE key = '_.userinfo') userinfo
             NATURAL LEFT JOIN
             (SELECT *, TRUE AS is_on_staff FROM staff) staff
             ORDER BY on_roster DESC, on_staff ASC, username`,
    }, cb),
    (result, cb) => cb(null, result.rows),
  ], done);
});

Omnivore.prototype.users = client(
                           types.check([ pg.Client, 'array' ], [ 'array' ],
                           function _users(client, usernames, done) {
  async.waterfall([
    cb => client.logQuery({
      name: 'users-select-users',
      text: `SELECT *, COALESCE(exists, FALSE) AS exists,
                       COALESCE(on_roster, FALSE) AS on_roster,
                       COALESCE(on_staff, FALSE) AS on_staff FROM
             UNNEST($1) WITH ORDINALITY AS username
             NATURAL LEFT JOIN
             (SELECT *, TRUE AS exists FROM users) users
             NATURAL LEFT JOIN
             (SELECT *, TRUE AS on_staff FROM staff) staff
             ORDER BY ordinality`,
      types: [ types.pg.TEXTarray ],
      values: [ usernames ],
    }, cb),
    (result, cb) => cb(null, result.rows),
  ], done);
}));

Omnivore.prototype.setRoster = client(transaction(
                               types.translate([ pg.Client, 'agent', 'username_array '], [ 'any' ],
                               function _setRoster(client, agent, usernames, done) {
  async.waterfall([
   cb => client.logQuery({
     name: 'setRoster-insert-users',
     text: `INSERT INTO users (username, on_roster) SELECT UNNEST($1), true ON CONFLICT DO NOTHING`,
     types: [ types.pg.TEXTarray ],
     values: [ usernames ],
   }, cb),
   (_, cb) => client.logQuery({
     name: 'setRoster-update-users',
     text: `UPDATE users SET on_roster = username = ANY($1)`,
     types: [ types.pg.TEXTarray ],
     values: [ usernames ],
   }, cb),
  ], done);
})));

Omnivore.prototype.keys = client(
                          types.translate([ pg.Client, 'key_array' ], [ 'row_array' ],
                          function _keys(client, keys, done) {
  async.waterfall([
    cb => client.logQuery({
      name: 'keys-select-keys',
      text: `SELECT keys.*, key, COALESCE(exists, FALSE) AS exists, inputs.inputs, outputs.outputs FROM
             UNNEST($1) WITH ORDINALITY AS key
             NATURAL LEFT JOIN
             (SELECT *, TRUE AS exists FROM keys) keys
             LEFT JOIN
             computations AS inputs ON (key = inputs.output)
             NATURAL LEFT JOIN LATERAL
             (SELECT key, ARRAY_AGG(output) AS outputs FROM computations WHERE key ? inputs) AS outputs
             ORDER BY ordinality`,
      types: [ types.pg.LTREEarray ],
      values: [ keys ],
    }, cb),
    (result, cb) => cb(null, result.rows),
    (rows, cb) => cb(null, rows.map(row => Object.assign(row, {
      inputs: row.inputs ? types.convertOut(row.inputs, 'key_array') : [],
      outputs: row.outputs ? types.convertOut(row.outputs, 'key_array') : [],
    }))),
  ], done);
}));

Omnivore.prototype.rules = client(
                           types.translate([ pg.Client, 'key' ], [ 'any' ],
                           function _rules(client, key, done) {
  let queries = {
    creators: [
      'SELECT agent, add FROM agents WHERE $1 ? add ORDER BY agent',
      row => Object.assign(row, { add: types.convertOut(row.add, 'key_ltree_query_array') }),
    ],
    writers: [
      'SELECT agent, write FROM agents WHERE $1 ? write ORDER BY agent',
      row => Object.assign(row, { write: types.convertOut(row.write, 'key_ltree_query_array') }),
    ],
    active: [
      'SELECT * FROM active_rules WHERE $1 ~ keys ORDER BY after',
      row => Object.assign(row, { keys: types.convertOut(row.keys, 'key_ltree_query') }),
    ],
    visible: [
      'SELECT * FROM visible_rules WHERE $1 ~ keys ORDER BY after',
      row => Object.assign(row, { keys: types.convertOut(row.keys, 'key_ltree_query') }),
    ],
    deadline: [
      'SELECT * FROM deadline_rules NATURAL JOIN penalties WHERE $1 ~ keys ORDER BY deadline',
      row => Object.assign(row, { keys: types.convertOut(row.keys, 'key_ltree_query') }),
    ],
    rules: [
      'SELECT * FROM key_rules WHERE $1 ~ keys',
      row => Object.assign(row, { keys: types.convertOut(row.keys, 'key_ltree_query') }),
    ],
    computed: [
      `SELECT * FROM computation_rules WHERE $1 ~ (CASE WHEN base IS NULL THEN '' ELSE base::TEXT || '.' END || output::TEXT)::LQUERY`,
      row => Object.assign(row, {
        base: types.convertOut(row.base, 'key_ltree_query'),
        output: types.convertOut(row.output, 'key'),
        inputs: types.convertOut(row.inputs, 'key_ltree_query_array'),
      }),
    ],
    computes: [
      `SELECT computation_rules.* FROM computation_rules, LATERAL unnest(inputs) AS input
       WHERE $1 ~ (CASE WHEN base IS NULL THEN '' ELSE base::TEXT || '.' END || input::TEXT)::LQUERY
       ORDER BY CASE WHEN base IS NULL THEN '' ELSE base::TEXT || '.' END || output::TEXT`,
      row => Object.assign(row, {
        base: types.convertOut(row.base, 'key_ltree_query'),
        output: types.convertOut(row.output, 'key'),
        inputs: types.convertOut(row.inputs, 'key_ltree_query_array'),
      }),
    ],
  };
  async.auto(Object.fromEntries(Object.entries(queries).map(([ rule, [ query, convert ] ]) => {
    return [ rule, cb => async.waterfall([
      cb => client.logQuery({
        name: `rules-select--${rule}`,
        text: query,
        types: [ types.pg.LTREE ],
        values: [ key ],
      }, cb),
      (result, cb) => cb(null, result.rows),
      (rows, cb) => cb(null, rows.map(convert)),
    ], cb) ];
  })), done);
}));

// add an active rule
Omnivore.prototype.active = client(transaction(
                            types.translate([ pg.Client, 'key', Date ], [ 'any' ],
                            function _active(client, pattern, after, done) {
  //console.log('active', pattern, after);
  client.logQuery({
    name: 'active-insert-active_rules',
    text: 'INSERT INTO active_rules (keys, after) VALUES ($1, $2)',
    values: [ pattern, after ],
  }, done);
})));

// add a visible rule
Omnivore.prototype.visible = client(transaction(
                             types.translate([ pg.Client, 'key', Date ], [ 'any' ],
                             function _visible(client, pattern, after, done) {
  //console.log('visible', pattern, after);
  client.logQuery({
    name: 'visible-insert-visible_rules',
    text: 'INSERT INTO visible_rules (keys, after) VALUES ($1, $2)',
    values: [ pattern, after ],
  }, done);
})));

// add a deadline penalty function
Omnivore.prototype.penalty = client(transaction(
                            types.check([ pg.Client, 'string', 'string', 'function' ], [ 'any' ],
                            function _penalty(client, name, description, lambda, done) {
  client.logQuery({
    name: 'penalty-insert-penalties',
    text: 'INSERT INTO penalties (penalty_id, penalty_description, penalize) VALUES ($1, $2, $3)',
    values: [ name, description, lambda ],
  }, done);
})));

// add a deadline rule
Omnivore.prototype.deadline = client(transaction(
                              types.translate([ pg.Client, 'key', Date, 'string' ], [ 'any' ],
                              function _deadline(client, pattern, deadline, penalty, done) {
  client.logQuery({
    name: 'deadline-insert-deadline_rules',
    text: 'INSERT INTO deadline_rules (keys, deadline, penalty_id) VALUES ($1, $2, $3)',
    values: [ pattern, deadline, penalty ],
  }, done);
})));

// add a key rule
Omnivore.prototype.meta = client(transaction(
                          types.translate([ pg.Client, 'key', 'object' ], [ 'any' ],
                          function _meta(client, pattern, meta, done) {
  client.logQuery({
    name: 'meta-insert-key_rules',
    text: 'INSERT INTO key_rules (keys, key_order, promotion, key_comment, values_comment) VALUES ($1, $2, $3, $4, $5)',
    values: [ pattern, meta.key_order, meta.promotion, meta.key_comment, meta.values_comment ],
  }, done);
})));

// add a computation rule
Omnivore.prototype.compute = client(transaction(
                          types.translate([ pg.Client, 'key', 'key', 'key_array', 'function' ], [ 'any' ],
                          function _compute(client, base, output, inputs, lambda, done) {
  //console.log('compute', base, output, inputs, lambda);
  client.logQuery({
    name: 'compute-insert-computation_rules',
    text: 'INSERT INTO computation_rules (base, output, inputs, compute) VALUES ($1, $2, $3, $4)',
    values: [ base === '' ? null : base, output, inputs, lambda ],
  }, done);
})));

Omnivore.prototype.cron = client(
                          Omnivore.prototype._cron = function _cron(client, done) {
  //console.log('cron');
  async.waterfall([
    cb => client.query(db_update, cb),
    (_, cb) => client.query({
      name: 'cron-delete-precompute_queue',
      text: 'DELETE FROM precompute_queue RETURNING *',
    }, cb),
    (result, cb) => cb(null, types.convertOut(result.rows, 'row_array')),
    (rows, cb) => async.series(rows.map(row => cb => setTimeout(() => this.get({
      username: row.username,
      key: row.key,
      hidden: true,
    }, cb), 10)), cb),
  ], done);
});
