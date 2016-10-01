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
