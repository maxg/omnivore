'use strict';

const assert = require('assert');
const util = require('util');

const pg = require('pg');
const xtype = require('xtypejs');
xtype.ext.registerExtension(require('xtypejs-extension-custom-types'));

// PostgreSQL type constants
exports.pg = {
  BOOL: 16,
  TEXT: 25,
  TEXTarray: 1009,
  LTREE: 16386, // XXX stable?
  LTREEarray: 16389, // XXX stable?
  LQUERY: 16440, // XXX stable?
  LQUERYarray: 16443, // XXX stable?
};
// use built-in array parser for LTREE and LQUERY arrays
pg.types.setTypeParser(exports.pg.LTREEarray, function parseLTREEarray(val) {
  if ( ! val) { return null; }
  return pg.types.arrayParser.create(val, entry => entry).parse();
});
pg.types.setTypeParser(exports.pg.LQUERYarray, function parseLQUERYarray(val) {
  if ( ! val) { return null; }
  return pg.types.arrayParser.create(val, entry => entry).parse();
});

const value_types = exports.value_types = [ 'boolean', 'number', 'nan', 'string', 'value_array', 'value_object' ];

// string restrictions
const course_regex = /^[A-Z0-9]+\.[A-Z0-9]+\/(fa|ia|sp|su)\d\d$/;
const agent_regex = /^\w+$/;
const username_regex = /^\w+$/;
const key_path_regex = /^(\/|(\/[\w-]+)+)$/;
const key_path_query_regex = /^(\/|(\!?[\w-]+%?(\|[\w-]+%?)*\*?|\*)?(\/(\!?[\w-]+%?(\|[\w-]+%?)*\*?|\*))*)$/;
const key_ltree_query_regex = /^(\!?[\w]+%?(\|[\w]+%?)*\*?|\*\{\d\})?(\.(\!?[\w]+%?(\|[\w]+%?)*\*?|\*\{\d\}))*$/;
const timestamp_regex = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{3})?(Z|\+0000)$/;

xtype.ext.registerType({
  value:     { definition: { validator: val => xtype.is(val, value_types) } },
  value_array: { definition: { validator: val => {
    return xtype.isArray(val) && val.every(elt => xtype.isValue(elt));
  } } },
  value_object: { definition: { validator: val => {
    return xtype.isObject(val) && Object.keys(val).every(key => xtype.isValue(val[key]));
  } } },
  course:    { definition: { validator: val => xtype.isString(val) && course_regex.test(val) } },
  agent:     { definition: { validator: val => xtype.isString(val) && agent_regex.test(val) } },
  username:  { definition: { validator: val => xtype.isString(val) && username_regex.test(val) } },
  maybe_username: { definition: 'undefined, username' },
  username_array: { definition: { validator: val => xtype.isArray(val) && xtype.all.isUsername(val) } },
  key:       { definition: { validator: val => xtype.isString(val) } },
  key_path:  { definition: { validator: val => xtype.isString(val) && key_path_regex.test(val) } },
  key_path_query:  { definition: { validator: val => xtype.isString(val) && key_path_query_regex.test(val) } },
  key_ltree_query: { definition: { validator: val => xtype.isString(val) && key_ltree_query_regex.test(val) } },
  maybe_key: { definition: 'undefined, key' },
  key_array: { definition: { validator: val => xtype.isArray(val) && xtype.all.isKey(val) } },
  timestamp: { definition: { validator: val => xtype.isString(val) && timestamp_regex.test(val) } },
  spec:      { definition: { validator: val => {
    return xtype.isObject(val) && xtype.isMaybeUsername(val.username) && xtype.isMaybeKey(val.key);
  } } },
  row:       { definition: { validator: val => xtype.isObject(val) } },
  row_array: { definition: { validator: val => xtype.isArray(val) && xtype.all.isRow(val) } },
});

const whichType = exports.which = function which(val, types) {
  return xtype.which(val, types);
};

const isType = exports.is = function is(val, type) {
  return xtype.is(val, type);
};

// assert that a value has a given xtype
const assertType = exports.assert = function assertType(val, type, desc) {
  if ( ! isType(val, type)) {
    assert.fail(xtype(val), type, `expected ${desc || 'instance of'} ${type}, was ${xtype(val)} ${util.inspect(val)}`);
  }
  return val;
};

const convertIn = exports.convertIn = function convertIn(val, type) {
  assertType(val, type);
  switch (type) {
    case 'key':
    case 'key_path_query':
      assertType(val, 'key_path_query');
      return val ? val.replace(/-/g, '_')
                      .replace(/(^|\/)\*/g, '/*{1}')
                      .replace(/^\//, '')
                      .replace(/\//g, '.')
                      .replace(/\*\{1\}\.\*\{1\}\.\*\{1\}/g, '*{3}') // XXX
                      .replace(/\*\{1\}\.\*\{1\}/g, '*{2}') // XXX
                 : val;
    case 'key_array':
      return val ? val.map(key => convertIn(key, 'key')) : val;
    case 'row':
      return Object.assign({}, val, { key: convertIn(val.key, 'key') });
    case 'row_array':
      return val.map(row => convertIn(row, 'row'));
    case 'spec':
      return val && val.key ? Object.assign({}, val, { key: convertIn(val.key, 'key') }) : val;
    default:
      return val;
  }
}

const convertOut = exports.convertOut = function convertOut(val, type) {
  assertType(val, type);
  switch (type) {
    case 'key':
    case 'key_ltree_query':
      assertType(val, 'key_ltree_query');
      return val ? '/' + val.replace(/_/g, '-')
                            .replace(/\*\{3\}/g, '*.*.*') // XXX
                            .replace(/\*\{2}/g, '*.*') // XXX
                            .replace(/\*\{1}/g, '*') // XXX
                            .replace(/\./g, '/')
                 : val;
    case 'key_array':
      return val ? val.map(key => convertOut(key, 'key')) : val;
    case 'row':
      return val && val.key ? Object.assign({}, val, { key: convertOut(val.key, 'key') }) : val;
    case 'row_array':
      return val ? val.map(row => convertOut(row, 'row')) : val;
    default:
      return val;
  }
}

// wrap a function to intercept and inspect or modify arguments and return values
//   fn must take a callback as last arg and call the callback with an error as first arg
function safely(argTypes, incoming, retTypes, outgoing, fn) {
  [ argTypes, retTypes ].forEach(types => types.forEach(type => assertType(type, 'string,function', 'xtype')));
  assertType(incoming, 'function', 'incoming');
  assertType(outgoing, 'function', 'outgoing');
  assertType(fn, 'function', 'to wrap');
  
  let safe = function(...originalArgs) {
    let originalCb = originalArgs.pop();
    assertType(originalCb, 'function', 'callback');
    assert.equal(argTypes.length, originalArgs.length, 'argument count mismatch');
    
    let types = argTypes[Symbol.iterator]();
    let args = originalArgs.map(arg => incoming(arg, types.next().value));
    let cb = (err, ...originalRets) => {
      if (err) { return originalCb.apply(this, [ err, ...originalRets ]); }
      assert.equal(retTypes.length, originalRets.length, 'return count mismatch');
      
      let types = retTypes[Symbol.iterator]();
      let rets = originalRets.map(ret => outgoing(ret, types.next().value));
      originalCb.apply(this, [ err, ...rets ]);
    };
    
    fn.apply(this, [ ...args, cb ]);
  };
  Object.defineProperty(safe, 'name', { value: `[safe]${fn.name}` });
  return safe;
}

// wrap a function to check argument and return types
//   see safely(..)
exports.check = function check(argTypes, retTypes, fn) {
  return safely(argTypes, assertType, retTypes, assertType, fn);
};

// wrap a function to type-check and translate arguments and return values to and from external reps
//   see safely(..)
exports.translate = function translate(argTypes, retTypes, fn) {
  return safely(argTypes, convertIn, retTypes, convertOut, fn);
};

exports.common = function(keys) {
  if ( ! keys.length) { return ''; }
  let splits = keys.map(key => key.split('/'));
  all:
  for (var ii = 0; ii < splits[0].length; ii++) {
    for (let jj = 1; jj < splits.length; jj++) {
      if (splits[jj][ii] !== splits[0][ii]) { break all; }
    }
  }
  return splits[0].slice(0, ii).join('/');
};

exports.dateTimeString = function(date) {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')
         + ' '
         + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/ (.)M/, (_, p) => p.toLowerCase());
};
