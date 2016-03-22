'use strict';

const fs = require('fs');

const should = require('should');
const xtype = require('xtypejs');

should.Assertion.add('read', function(expect) {
  this.params = { operator: 'to read ' + should.format(expect) };
  if (xtype.is(expect, [ 'null', 'boolean', 'integer', 'string' ])) {
    return should(this.obj).equal(expect);
  }
  should.exist(this.obj);
  if (xtype.is(expect, 'array')) {
    this.obj.should.be.an.Array();
    this.obj.should.have.length(expect.length);
    let actual = this.obj[Symbol.iterator]();
    for (let expected of expect) {
      should(actual.next().value).read(expected);
    }
    return;
  }
  if (xtype.is(expect, [ Map, Set ])) {
    should(this.obj.size).equal(expect.size);
    let actual = this.obj[Symbol.iterator]();
    for (let expected of expect) {
      should(actual.next().value).read(expected);
    }
  }
  if (xtype.is(expect, 'object')) {
    this.obj.should.be.an.Object();
    for (let key of Object.keys(expect)) {
      should(this.obj[key]).read(expect[key]);
    }
    return;
  }
  if (xtype.is(expect, Date)) {
    this.obj.should.be.an.instanceof(Date);
    return should(this.obj.getTime()).equal(expect.getTime());
  }
  should.fail(this.obj, expect, `cannot use should.read with ${xtype(expect)}`);
});

global.fixtures = function fixtures(file) {
  return fs.readFileSync(`./test/fixtures/${file}.sql`, { encoding: 'utf-8' });
};

global.bail = function bail(done, check) {
  return function bailOnError(err, ...args) {
    if (err) { return done(err); }
    check.apply(this, args);
  }
};

global.range = function range(max) {
  return Array.from(Array(max).keys());
};

global.t_minus = function t_minus(t, days) {
  return t_plus(t, -days);
};

global.t_plus = function t_plus(t, days) {
  return new Date(new Date(t).setDate(t.getDate() + days));
};
