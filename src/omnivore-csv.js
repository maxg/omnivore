'use strict';

const csv = require('csv');

const types = require('./omnivore-types');

exports.stringify = function stringify(keys, rows, comments) {
  types.assert(keys, 'key_array');
  types.assert(rows, 'array');
  types.assert(comments, 'array|undefined');
  
  let sheet = csv.stringify({
    quotedString: true,
  });
  sheet.write([ 'username', ...keys, ...(comments || []) ]);
  for (let row of rows) {
    sheet.write([ row.username, ...keys.map(key => row[key].value) ]);
  }
  process.nextTick(() => sheet.end());
  return sheet;
};

exports.parse = function parse(input) {
  let sheet = csv.parse({
    skip_empty_lines: true,
    trim: true,
    auto_parse: true,
  });
  let keys = [];
  let rows = [];
  sheet.once('data', keyrow => {
    for (let key of keyrow.slice(1)) {
      if (types.is(key, 'key_path')) {
        keys.push(key);
      } else {
        break;
      }
    }
    sheet.on('data', datarow => {
      let username = datarow[0];
      let values = datarow.slice(1, keys.length+1).map(val => {
        if (val === '') { return null; }
        if (val === 'true') { return true; }
        if (val === 'false') { return false; }
        return val;
      });
      rows.push({
        username,
        valid: types.is(username, 'username'),
        values,
      });
    });
  });
  sheet.once('finish', () => sheet.emit('parsed', keys, rows));
  process.nextTick(() => sheet.end(input));
  return sheet;
};
