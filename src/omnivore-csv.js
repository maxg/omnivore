'use strict';

const events = require('events');

const csv = require('csv');

const types = require('./omnivore-types');

exports.stringify = function stringify(keys, rows, comments) {
  types.assert(keys, 'key_array');
  types.assert(rows, 'array');
  types.assert(comments, 'array|undefined');
  
  let emitter = new events.EventEmitter();
  let sheet = exports.streamify(keys, emitter, comments);
  emitter.emit('rows', rows);
  process.nextTick(() => emitter.emit('end'));
  return sheet;
};

exports.streamify = function streamify(keys, emitter, comments) {
  types.assert(keys, 'key_array');
  types.assert(emitter, 'object');
  types.assert(comments, 'array|undefined');
  
  let sheet = csv.stringify({
    quotedString: true,
  });
  sheet.write([ 'username', ...keys, ...(comments || []) ]);
  emitter.on('rows', rows => {
    for (let row of rows) {
      sheet.write([ row.username, ...keys.map(key => row[key].value) ]);
    }
  });
  emitter.on('end', () => sheet.end());
  return sheet;
};

exports.parse = function parse(input) {
  types.assert(input, [ Buffer, 'string' ]);
  
  let sheet = csv.parse({
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  });
  let keys = [];
  let ts = undefined;
  let rows = [];
  sheet.once('data', ([ , ...keyrow ]) => {
    for (let key of keyrow) {
      if (types.is(key, 'key_path')) {
        keys.push(key);
      } else {
        if (types.is(key, 'timestamp')) { ts = new Date(key); }
        break;
      }
    }
  });
  sheet.once('data', () => sheet.on('data', ([ username, ...datarow ]) => {
    let values = datarow.slice(0, keys.length).map(convert);
    while (values.length < keys.length) {
      values.push(undefined);
    }
    rows.push({ username, values });
  }));
  sheet.once('finish', () => sheet.emit('parsed', keys, ts, rows));
  process.nextTick(() => sheet.end(input));
  return sheet;
};

const convert = exports.convert = function convert(val) {
  if (convert.is_int(val)) { return parseInt(val); }
  if (convert.is_float(val)) { return parseFloat(val); }
  if (val === '') { return undefined; }
  if (val === 'true') { return true; }
  if (val === 'false') { return false; }
  // does not convert: nan, value_array, and value_object
  return val.replace(/\r\n?/g, '\n');
};
convert.is_int = RegExp.prototype.test.bind(csv.parse().is_int);
convert.is_float = csv.parse().is_float;
