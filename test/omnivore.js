'use strict';

const fs = require('fs');
const crypto = require('crypto');
const util = require('util');

const async = require('async');
const should = require('should');
const sinon = require('sinon');

const omnivore = require('../src/omnivore');

describe('Omnivore', function() {
  
  let sandbox = sinon.sandbox.create();
  
  let omni = new omnivore.Omnivore('TEST.OMNIVORE/ia00');
  let now = new Date();
  
  let ready = new Promise(resolve => omni.once('ready', resolve));
  before(done => { ready.then(done) });
  
  beforeEach(done => {
    omni.pg((client, done) => {
      async.series([
        cb => client.query(fixtures('destroy'), cb),
        cb => client.query(fixtures('base'), cb),
      ], done);
    }, done);
  });
  
  afterEach(() => sandbox.restore());
  
  describe('types', () => {
    
    new Map([
      [ 'value', [
        [ false, true ],
        [ 0, true ],
        [ NaN, true ],
        [ Infinity, true ],
        [ '', true ],
        [ null, false ],
        [ undefined, false ],
        [ [ 1, '2' ], true ],
        [ [ () => {} ], false ],
        [ { 1: '2', 'three': [ 'four' ], '5': { } }, true ],
        [ { x: null }, false ],
        [ { y: new Date(0) }, false ],
        [ { z: { a: /b/ } }, false ],
      ] ],
      [ 'course', [
        [ '6.005/fa15', true ],
        [ 'SIX.DOUBLEOHFIVE/fa15', true ],
        [ '6.S04/fa15', true ],
        [ '6.s04/fa15', false ],
      ] ],
      [ 'key_path', [
        [ '', false ],
        [ '/', true ],
        [ '/a', true ],
        [ '/a/', false ],
        [ '/a/b', true ],
        [ '/*/b', false ],
        [ '/a/*', false ],
        [ 'a/b', false ],
      ] ],
      [ 'key_path_query', [
        [ '', true ],
        [ '/', true ],
        [ '/a', true ],
        [ '/a/', false ],
        [ '/a/b', true ],
        [ '/*/b', true ],
        [ '/a/*', true ],
        [ 'a/b', true ],
        [ '*/b', true ],
        [ 'a/*', true ],
      ] ],
      [ 'key_ltree_query', [
        [ '', true ],
        [ '.', false ],
        [ 'a', true ],
        [ 'a.', false ],
        [ 'a.b', true ],
        [ '*.b', false ],
        [ '*{1}.b', true ],
        [ 'b.*{1}', true ],
      ] ],
    ]).forEach((pairs, type) => {
      describe(type, () => {
        new Map(pairs).forEach((expected, value) => {
          it(`${util.inspect(value)} ${expected ? 'is' : 'is not'} ${type}`, () => {
            omnivore.types.which(value, [ type ]).should.equal(expected ? type : 'none');
            omnivore.types.is(value, type).should.equal(expected);
            if (expected) {
              omnivore.types.assert(value, type).should.eql(value);
            } else {
              (function() { omnivore.types.assert(value, type); }).should.throw();
            }
          });
        });
      });
    });
    
    describe('#common()', () => {
      
      it('should return empty for no keys', () => {
        omnivore.types.common([]).should.eql('');
      });
      it('should return single key', () => {
        omnivore.types.common([ '/a/b/c' ]).should.eql('/a/b/c');
      });
      it('should find empty common prefix', () => {
        omnivore.types.common([ '/a/b/c', '/b/c' ]).should.eql('');
      });
      it('should find one-element common prefix', () => {
        omnivore.types.common([ '/a/b/c', '/a/c/d' ]).should.eql('/a');
      });
      it('should find multi-element common prefix', () => {
        omnivore.types.common([ '/a/b/c', '/a/b/d' ]).should.eql('/a/b');
      });
    });
    
    describe('#dateTimeString()', () => {
      it('should format date', () => {
        omnivore.types.dateTimeString(new Date(2017, 0, 1, 13)).should.eql('Sun Jan 1 1:00p');
      });
    });
  });
  
  describe('csv', () => {
    
    describe('#stringify()', () => {
      
      it('should export header row', done => {
        let sheet = omnivore.csv.stringify([ '/a', '/b' ], [ ], [ 'my comment' ]);
        sheet.setEncoding('utf-8');
        sheet.read().should.eql('"username","/a","/b","my comment"\n');
        done();
      });
      it('should export values', done => {
        let sheet = omnivore.csv.stringify([ '/a', '/b' ], [
          { username: 'alice', '/a': { value: 5 }, '/b': { value: '\'hello\'\n"there"' } },
        ]);
        sheet.setEncoding('utf-8');
        sheet.read().should.eql('"username","/a","/b"\n"alice",5,"\'hello\'\n""there"""\n');
        done();
      });
    });
    
    describe('#parse()', () => {
      
      new Map([
        [ 'boolean',
          [ [ `true`, true ], [ `"true"`, true ] ] ],
        [ 'number',
          [ [ `5`, 5 ], [ `"5"`, 5 ], [ `-5.1`, -5.1 ] ] ],
        [ 'string',
          [ [ `a`, 'a' ], [ `"'hello'\n""there"""`, `'hello'\n"there"` ], [ `" "`, ' ' ],
            [ `null`, 'null' ], [ `undefined`, 'undefined' ] ] ],
        [ 'undefined',
          [ [ ``, undefined ], [ `""`, undefined ], [ `   `, undefined ] ] ],
      ]).forEach((pairs, type) => {
        describe(type, () => {
          new Map(pairs).forEach((expected, value) => {
            it(`should parse value ${util.inspect(value)}`, done => {
              let sheet = omnivore.csv.parse(`username,/middle,/end
                                              alice,${value},${value}`);
              sheet.once('parsed', (keys, rows) => {
                rows.should.read([ { values: [ expected, expected ] } ]);
                done();
              });
            });
          });
        });
      });
      
      it('should parse users and keys', done => {
        let sheet = omnivore.csv.parse(`username,/a,/b
                                        alice
                                        bob,1,2`);
        sheet.once('parsed', (keys, rows) => {
          keys.should.eql([ '/a', '/b' ]);
          rows.should.read([ { username: 'alice' }, { username: 'bob' } ]);
          done();
        });
      });
      
      it('should ignore past invalid key', done => {
        let sheet = omnivore.csv.parse(`username,/a,/b-c,/d/e/f,x,/g,/h
                                        alice,1,2,3,4,5,6`);
        sheet.once('parsed', (keys, rows) => {
          keys.should.eql([ '/a', '/b-c', '/d/e/f' ]);
          rows.should.read([ { username: 'alice', values: [ 1, 2, 3 ] } ]);
          done();
        });
      });
      
      it('should ignore extra values', done => {
        let sheet = omnivore.csv.parse(`username,/a,/b
                                        alice,1.1,2.2,3.3`);
        sheet.once('parsed', (keys, rows) => {
          keys.should.eql([ '/a', '/b' ]);
          rows.should.read([ { username: 'alice', values: [ 1.1, 2.2 ] } ]);
          done();
        });
      });
      
      it('should fill in missing values', done => {
        let sheet = omnivore.csv.parse(`username,/a,/b
                                        alice,apple`);
        sheet.once('parsed', (keys, rows) => {
          keys.should.eql([ '/a', '/b' ]);
          rows.should.read([ { username: 'alice', values: [ 'apple', undefined ] } ]);
          done();
        });
      });
      
      it('should include invalid users', done => {
        let sheet = omnivore.csv.parse(`username,/a
                                        alice@mit,1
                                        bob,2`);
        sheet.once('parsed', (keys, rows) => {
          keys.should.eql([ '/a' ]);
          rows.should.read([
            { username: 'alice@mit', valid: false, values: [ 1 ] },
            { username: 'bob', valid: true, values: [ 2 ] },
          ]);
          done();
        });
      });
    });
  });
  
  describe('#parse()', () => {
    
    it('should parse signed JSON', done => {
      let input = [ { username: 'alice', key: '/test/alpha', ts: now, value: 100 } ];
      let json = JSON.stringify(input);
      let sign = crypto.createSign('RSA-SHA256');
      sign.update(json);
      let signature = sign.sign(fs.readFileSync('test/fixtures/key-private.pem'), 'base64');
      omni.parse('tester', signature, json, bail(done, output => {
        output.should.eql(input);
        done();
      }));
    });
    
    it('should reject bad signature', done => {
      let input = [ { username: 'alice', key: '/test/alpha', ts: now, value: 100 } ];
      let json = JSON.stringify(input);
      let sign = crypto.createSign('RSA-SHA256');
      sign.update(json);
      let signature = sign.sign(fs.readFileSync('test/fixtures/key-private.pem'), 'base64');
      omni.parse('tester', signature.slice(1), json, (err, output) => {
        should.exist(err);
        done(output);
      });
    });
  });
  
  describe('#add()', () => {
    
    beforeEach(done => {
      async.series([
        cb => omni.visible('/test/*', now, cb),
      ], done);
    });
    
    it('should add data', done => {
      omni.add('tester', 'alice', '/test/alpha', now, 100, bail(done, () => {
        omni.get({ username: 'alice', key: '/test/alpha' }, bail(done, rows => {
          rows.should.read([
            { username: 'alice', key: '/test/alpha', ts: now, value: 100 },
          ]);
          done();
        }));
      }));
    });
    
    it('should allow duplicate data', done => {
      async.series([
        cb => omni.add('tester', 'alice', '/test/alpha', now, 100, cb),
        cb => omni.get({ username: 'alice', key: '/test/alpha' }, cb),
        cb => omni.add('tester', 'alice', '/test/alpha', now, 100, cb),
        cb => omni.get({ username: 'alice', key: '/test/alpha' }, cb),
      ], bail(done, results => {
        results[1].should.read([ { value: 100 } ]);
        results[3].should.read([ { value: 100 } ]);
        done();
      }));
    });
    
    it('should disallow conflicting data', done => {
      async.series([
        cb => omni.add('tester', 'alice', '/test/alpha', now, 100, cb),
        cb => omni.add('tester', 'alice', '/test/alpha', now, 50, cb),
      ], err => {
        should.exist(err);
        omni.get({}, bail(done, rows => {
          rows.should.read([
            { username: 'alice', key: '/test/alpha', ts: now, value: 100 },
          ]);
          done();
        }));
      });
    });
    
    it('should update data', done => {
      async.series([
        cb => omni.add('tester', 'alice', '/test/alpha', now, 100, cb),
        cb => omni.get({ username: 'alice', key: '/test/alpha' }, cb),
        cb => omni.add('tester', 'alice', '/test/alpha', new Date(), 70, cb),
        cb => omni.get({ username: 'alice', key: '/test/alpha' }, cb),
      ], bail(done, results => {
        results[1].should.read([ { value: 100 } ]);
        results[3].should.read([ { value: 70 } ]);
        done();
      }));
    });
    
    context('computation', () => {
      
      beforeEach(done => {
        async.series([
          cb => omni.active('/test/alpha', now, cb),
          cb => omni.compute('/test', 'beta', [ 'alpha' ], alpha => alpha / 2, cb),
        ], done);
      });
      
      it('should initialize output', done => {
        async.series([
          cb => omni.multiadd('tester', [
            { username: 'alice', key: '/test/gamma', ts: now, value: 20 },
            { username: 'bob', key: '/test/alpha', ts: now, value: 90 },
          ], cb),
          cb => omni.get({ username: 'alice', key: '/test/beta' }, cb),
          cb => omni.add('tester', 'alice', '/test/alpha', new Date(), 60, cb),
          cb => omni.get({ username: 'alice', key: '/test/beta' }, cb),
        ], bail(done, results => {
          results[1].should.read([ { value: 0 } ]);
          results[3].should.read([ { value: 30 } ]);
          done();
        }));
      });
      
      it('should update output', done => {
        async.series([
          cb => omni.add('tester', 'alice', '/test/alpha', now, 100, cb),
          cb => omni.get({ username: 'alice', key: '/test/beta' }, cb),
          cb => omni.add('tester', 'alice', '/test/alpha', new Date(), 70, cb),
          cb => omni.get({ username: 'alice', key: '/test/beta' }, cb),
        ], bail(done, results => {
          results[1].should.read([ { value: 50 } ]);
          results[3].should.read([ { value: 35 } ]);
          done();
        }));
      });
    });
    
    context('chained computation', () => {
      
      beforeEach(done => {
        async.series([
          cb => omni.active('/test/*', now, cb),
          cb => omni.compute('/test', 'beta', [ 'alpha' ], alpha => alpha / 2, cb),
          cb => omni.compute('/test', 'gamma', [ 'beta' ], beta => beta + 5, cb),
        ], done);
      });
      
      it('should update output', done => {
        async.series([
          cb => omni.add('tester', 'alice', '/test/alpha', now, 100, cb),
          cb => omni.get({ username: 'alice', key: '/test/gamma' }, cb),
          cb => omni.add('tester', 'alice', '/test/alpha', new Date(), 70, cb),
          cb => omni.get({ username: 'alice', key: '/test/gamma' }, cb),
        ], bail(done, results => {
          results[1].should.read([ { value: 55 } ]);
          results[3].should.read([ { value: 40 } ]);
          done();
        }));
      });
    });
    
    context('chained wildcard computation', () => {
      
      beforeEach(done => {
        async.series([
          cb => omni.active('/test/*/*', now, cb),
          cb => omni.compute('/test/*', 'middle', [ 'left' ], left => left / 2, cb),
          cb => omni.compute('/test', 'right', [ '*/middle' ], mids => sum(mids), cb),
        ], done);
      });
      
      it('should update output', done => {
        async.series([
          cb => omni.add('tester', 'alice', '/test/alpha/left', now, 100, cb),
          cb => omni.get({ username: 'alice', key: '/test/right' }, cb),
          cb => omni.add('tester', 'alice', '/test/beta/left', new Date(), 70, cb),
          cb => omni.get({ username: 'alice', key: '/test/right' }, cb),
        ], bail(done, results => {
          results[1].should.read([ { value: 50 } ]);
          results[3].should.read([ { value: 85 } ]);
          done();
        }));
      });
    });
    
    context('no deadline', () => {
      
      it('should pick later', done => {
        async.series([
          cb => omni.add('tester', 'alice', '/test/alpha', now, 50, cb),
          cb => omni.add('tester', 'bob', '/test/alpha', now, 100, cb),
          cb => omni.add('tester', 'alice', '/test/alpha', t_minus(now, 1), 100, cb),
          cb => omni.add('tester', 'bob', '/test/alpha', t_plus(now, 1), 50, cb),
          cb => omni.get({ key: '/test/alpha' }, cb),
        ], bail(done, results => {
          results[4].should.read([
            { username: 'alice', ts: now, value: 50 },
            { username: 'bob', ts: t_plus(now, 1), value: 50 },
          ]);
          done();
        }));
      });
    });
    
    context('deadline', () => {
      
      beforeEach(done => {
        async.series([
          cb => omni.penalty('late', 'Note lateness', (due, ts, value) => `${value} late`, cb),
          cb => omni.deadline('/test/*', now, 'late', cb),
        ], done);
      });
      
      it('with no current should pick new', done => {
        async.series([
          cb => omni.add('tester', 'alice', '/test/alpha', t_minus(now, 1), 100, cb),
          cb => omni.add('tester', 'bob', '/test/alpha', t_plus(now, 1), 70, cb),
          cb => omni.get({ key: '/test/alpha' }, cb),
        ], bail(done, results => {
          results[2].should.read([
            { username: 'alice', ts: t_minus(now, 1), value: 100 },
            { username: 'bob', ts: t_plus(now, 1), value: '70 late' },
          ]);
          done();
        }));
      });
      
      it('with on-time current should pick later on-time', done => {
        async.series([
          cb => omni.add('tester', 'alice', '/test/alpha', t_minus(now, 1), 50, cb),
          cb => omni.add('tester', 'bob', '/test/alpha', t_minus(now, 1), 50, cb),
          cb => omni.add('tester', 'yolanda', '/test/alpha', t_minus(now, 1), 50, cb),
          cb => omni.get({ key: '/test/alpha' }, cb),
          cb => omni.add('tester', 'alice', '/test/alpha', t_minus(now, 2), 100, cb),
          cb => omni.add('tester', 'bob', '/test/alpha', now, 100, cb),
          cb => omni.add('tester', 'yolanda', '/test/alpha', t_plus(now, 1), 100, cb),
          cb => omni.get({ key: '/test/alpha' }, cb),
        ], bail(done, results => {
          results[3].should.read([ { value: 50 }, { value: 50 }, { value: 50 } ]);
          results[7].should.read([
            { username: 'alice', ts: t_minus(now, 1), value: 50 },
            { username: 'bob', ts: now, value: 100 },
            { username: 'yolanda', ts: t_minus(now, 1), value: 50 },
          ]);
          done();
        }));
      });
      
      it('with late current should pick earlier late or on-time', done => {
        async.series([
          cb => omni.add('tester', 'alice', '/test/alpha', t_plus(now, 2), 50, cb),
          cb => omni.add('tester', 'bob', '/test/alpha', t_plus(now, 2), 50, cb),
          cb => omni.add('tester', 'yolanda', '/test/alpha', t_plus(now, 2), 50, cb),
          cb => omni.get({ key: '/test/alpha' }, cb),
          cb => omni.add('tester', 'alice', '/test/alpha', now, 100, cb),
          cb => omni.add('tester', 'bob', '/test/alpha', t_plus(now, 1), 100, cb),
          cb => omni.add('tester', 'yolanda', '/test/alpha', t_plus(now, 3), 100, cb),
          cb => omni.get({ key: '/test/alpha' }, cb),
        ], bail(done, results => {
          results[3].should.read([ { value: '50 late' }, { value: '50 late' }, { value: '50 late' } ]);
          results[7].should.read([
            { username: 'alice', ts: now, value: 100 },
            { username: 'bob', ts: t_plus(now, 1), value: '100 late' },
            { username: 'yolanda', ts: t_plus(now, 2), value: '50 late' },
          ]);
          done();
        }));
      });
    });
  });
  
  describe('#multiadd()', () => {
    
    beforeEach(done => {
      async.series([
        cb => omni.visible('/test/*', now, cb),
      ], done);
    });
    
    it('should add data', done => {
      async.series([
        cb => omni.multiadd('tester', [
          { username: 'alice', key: '/test/alpha', ts: now, value: 90 },
          { username: 'bob', key: '/test/alpha', ts: now, value: 80 },
        ], cb),
        cb => omni.get({}, cb),
      ], bail(done, results => {
        results[1].should.read([
          { username: 'alice', key: '/test/alpha', ts: now, value: 90 },
          { username: 'bob', key: '/test/alpha', ts: now, value: 80 },
        ]);
        done();
      }));
    });
  });
  
  describe('#get()', () => {
    
    beforeEach(done => {
      async.series([
        cb => omni.add('tester', 'alice', '/test/alpha', now, 100, cb),
        cb => omni.add('tester', 'bob', '/test/alpha', now, 80, cb),
        cb => omni.compute('/test', 'beta', [ 'alpha' ], alpha => alpha / 2, cb),
        cb => omni.active('/test/alpha', now, cb),
        cb => omni.visible('/test/*', now, cb),
      ], done);
    });
    
    it('should return data for user + key', done => {
      omni.get({ username: 'alice', key: '/test/alpha' }, bail(done, rows => {
        rows.should.read([
          { username: 'alice', key: '/test/alpha', ts: now, value: 100 },
        ]);
        done();
      }));
    });
    
    it('should return all data for key', done => {
      omni.get({ key: '/test/alpha' }, bail(done, rows => {
        rows.should.read([
          { username: 'alice', key: '/test/alpha', ts: now, value: 100 },
          { username: 'bob', key: '/test/alpha', ts: now, value: 80 },
        ]);
        done();
      }));
    });
    
    context('computation', () => {
      
      it('should return computed for user + key', done => {
        omni.get({ username: 'alice', key: '/test/beta' }, bail(done, rows => {
          rows.should.read([
            { username: 'alice', key: '/test/beta', ts: now, value: 50 },
          ]);
          done();
        }));
      });
      
      it('should return all computed for key', done => {
        omni.get({ key: '/test/beta' }, bail(done, rows => {
          rows.should.read([
            { username: 'alice', key: '/test/beta', ts: now, value: 50 },
            { username: 'bob', key: '/test/beta', ts: now, value: 40 },
          ]);
          done();
        }));
      });
    });
    
    context('multiple inputs', () => {
      
      beforeEach(done => {
        async.series([
          cb => omni.add('tester', 'alice', '/test/gamma', t_plus(now, 1), 50, cb),
          cb => omni.compute('/test', 'delta', [ 'alpha', 'gamma' ], (alpha, gamma) => alpha + gamma, cb),
          cb => omni.active('/test/gamma', now, cb),
        ], done);
      });
      
      it('should return output with all inputs', done => {
        omni.get({ username: 'alice', key: '/test/delta' }, bail(done, rows => {
          rows.should.read([
            { username: 'alice', key: '/test/delta', value: 150 },
          ]);
          done();
        }));
      });
      
      it('should return output with some inputs', done => {
        omni.get({ username: 'bob', key: '/test/delta' }, bail(done, rows => {
          rows.should.read([
            { username: 'bob', key: '/test/delta', value: 80 },
          ]);
          done();
        }));
      });
      
      it('should return output using latest input timestamp', done => {
        omni.get({ key: '/test/delta' }, bail(done, rows => {
          rows.should.read([
            { username: 'alice', key: '/test/delta', ts: t_plus(now, 1) },
            { username: 'bob', key: '/test/delta', ts: now },
          ]);
          done();
        }));
      });
    });
    
    context('chained computation', () => {
      
      beforeEach(done => {
        async.series([
          cb => omni.compute('/test', 'gamma', [ 'beta' ], beta => beta + 5, cb),
          cb => omni.active('/test/beta', now, cb),
        ], done);
      });
      
      it('should return output', done => {
        omni.get({ username: 'alice', key: '/test/gamma' }, bail(done, rows => {
          rows.should.read([
            { username: 'alice', key: '/test/gamma', ts: now, value: 55 },
          ]);
          done();
        }));
      });
    });
    
    context('missing', () => {
      
      beforeEach(done => {
        async.series([
          cb => omni.add('tester', 'eve', '/test/gamma', now, 90, cb),
        ], done);
      });
      
      it('should return no data for missing input', done => {
        omni.get({ username: 'eve', key: '/test/alpha' }, bail(done, rows => {
          rows.should.read([
            { username: 'eve', key: '/test/alpha', ts: null, value: null },
          ]);
          done();
        }));
      });
      
      it('should return computed output', done => {
        omni.get({ username: 'eve', key: '/test/beta' }, bail(done, rows => {
          rows.should.read([
            { username: 'eve', key: '/test/beta', ts: null, value: 0 },
          ]);
          done();
        }));
      });
    });
    
    context('forced', () => {
      
      beforeEach(done => {
        async.series([
          cb => omni.add('tester', 'eve', '/test/beta', now, 90, cb),
        ], done);
      });
      
      it('should return no data for missing input', done => {
        omni.get({ username: 'eve', key: '/test/alpha' }, bail(done, rows => {
          rows.should.read([
            { username: 'eve', key: '/test/alpha', ts: null, value: null },
          ]);
          done();
        }));
      });
      
      it('should return data for output', done => {
        omni.get({ username: 'eve', key: '/test/beta' }, bail(done, rows => {
          rows.should.read([
            { username: 'eve', key: '/test/beta', ts: now, value: 90 },
          ]);
          done();
        }));
      });
    });
    
    context('overridden', () => {
      
      beforeEach(done => {
        async.series([
          cb => omni.add('tester', 'eve', '/test/alpha', now, 60, cb),
          cb => omni.add('tester', 'eve', '/test/beta', now, 70, cb),
        ], done);
      });
      
      it('should return data for input', done => {
        omni.get({ username: 'eve', key: '/test/alpha' }, bail(done, rows => {
          rows.should.read([
            { username: 'eve', key: '/test/alpha', ts: now, value: 60 },
          ]);
          done();
        }));
      });
      
      it('should return data for output', done => {
        omni.get({ username: 'eve', key: '/test/beta' }, bail(done, rows => {
          rows.should.read([
            { username: 'eve', key: '/test/beta', ts: now, value: 70 },
          ]);
          done();
        }));
      });
    });
    
    context('inactive', () => {
      
      beforeEach(done => {
        async.series([
          cb => omni.compute('/test', 'gamma', [ 'alpha/*', 'beta/*' ], (a, b) => `${a};${b}`, cb),
          cb => omni.active('/test/*/2', now, cb),
          cb => omni.visible('/test/*', now, cb),
          cb => omni.add('tester', 'alice', '/test/alpha/1', now, 'A1', cb),
          cb => omni.add('tester', 'alice', '/test/alpha/2', now, 'A2', cb),
          cb => omni.add('tester', 'alice', '/test/beta/1', now, 'B1', cb),
        ], done);
      });
      
      it('should return output using active inputs', done => {
        omni.get({ username: 'alice', key: '/test/gamma' }, bail(done, rows => {
          rows.should.read([
            { username: 'alice', key: '/test/gamma', ts: now, value: 'A2;' },
          ]);
          done();
        }));
      });
      
      it('should chain computation using active inputs');
    });
    
    context('hidden', () => {
      
      it('should not return hidden data');
      
      it('should not return hidden output');
    });
    
    context('penalized', () => {
      
      let deadline = t_minus(now, 1);
      let penalty_id = 'ten-per-day';
      
      beforeEach(done => {
        async.series([
          cb => omni.penalty(penalty_id, '10 points off per day late', (due, ts, value) => {
            return value - 10 * (ts - due) / 1000 / 60 / 60 / 24;
          }, cb),
        ], done);
      });
      
      it('should apply penalty to data', done => {
        async.series([
          cb => omni.deadline('/test/alpha', deadline, penalty_id, cb),
          cb => omni.get({ key: '/test/alpha' }, cb),
        ], bail(done, results => {
          results[1].should.read([
            { username: 'alice', value: 90, deadline },
            { username: 'bob', value: 70, deadline },
          ]);
          done();
        }));
      });
      
      it('should apply penalty to input', done => {
        async.series([
          cb => omni.deadline('/test/alpha', deadline, penalty_id, cb),
          cb => omni.get({ key: '/test/beta' }, cb),
        ], bail(done, results => {
          results[1].should.read([
            { username: 'alice', value: 45, deadline: null },
            { username: 'bob', value: 35, deadline: null },
          ]);
          done();
        }));
      });
      
      it('should apply penalty to output', done => {
        async.series([
          cb => omni.deadline('/test/beta', deadline, penalty_id, cb),
          cb => omni.get({ key: '/test/beta' }, cb),
        ], bail(done, results => {
          results[1].should.read([
            { username: 'alice', value: 40, deadline },
            { username: 'bob', value: 30, deadline },
          ]);
          done();
        }));
      });
    })
  });
  
  describe('#multiget()', () => {
    
    beforeEach(done => {
      async.series([
        cb => omni.add('tester', 'alice', '/test/alpha', now, 100, cb),
        cb => omni.add('tester', 'bob', '/test/alpha', now, 80, cb),
        cb => omni.compute('/test', 'beta', [ 'alpha' ], alpha => alpha / 2, cb),
        cb => omni.active('/test/alpha', now, cb),
        cb => omni.visible('/test/*', now, cb),
      ], done);
    });
    
    it('should return values for user + keys', done => {
      omni.multiget([ '/test/alpha', '/test/beta' ], { username: 'alice' }, bail(done, rows => {
        rows.should.read([
          { username: 'alice', '/test/alpha': { value: 100 }, '/test/beta': { value: 50 } },
        ]);
        done();
      }));
    });
    
    it('should return values for keys', done => {
      omni.multiget([ '/test/alpha', '/test/beta' ], {}, bail(done, rows => {
        rows.should.read([
          { username: 'alice', '/test/alpha': { value: 100 }, '/test/beta': { value: 50 } },
          { username: 'bob', '/test/alpha': { value: 80 }, '/test/beta': { value: 40 } },
        ]);
        done();
      }));
    });
  });
  
  describe('#allStaff()', () => {
    
    it('should return staff', done => {
      omni.allStaff(bail(done, result => {
        result.should.read(new Set([ 'staffer' ]));
        done();
      }));
    });
    
    it('should memoize staff', done => {
      async.series([
        cb => omni.memo.allStaff(cb),
        cb => { sandbox.stub(omni, 'allStaff').throws(); cb(); },
        cb => omni.memo.allStaff(cb),
      ], bail(done, results => {
        results[0].should.read(new Set([ 'staffer' ]));
        results[2].should.read(new Set([ 'staffer' ]));
        done();
      }));
    });
  });
  
  describe('#allUsers()', () => {
    
    beforeEach(done => {
      async.series([
        cb => omni.add('tester', 'alice', '/test/alpha', now, 10, cb),
        cb => omni.add('tester', 'bob', '/test/beta', now, 20, cb),
      ], done);
    });
    
    it('should return users', done => {
      omni.allUsers(bail(done, result => {
        result.should.read([
          { username: 'alice', on_roster: false, on_staff: false },
          { username: 'bob', on_roster: false, on_staff: false },
        ]);
        done();
      }));
    });
  });
  
  describe('#users()', () => {
    
    beforeEach(done => {
      async.series([
        cb => omni.add('tester', 'alice', '/test/alpha', now, 10, cb),
        cb => omni.add('tester', 'bob', '/test/beta', now, 20, cb),
      ], done);
    });
    
    it('should return users in order', done => {
      omni.users([ 'bob', 'alice' ], bail(done, result => {
        result.should.read([
          { username: 'bob', exists: true, on_roster: false, on_staff: false },
          { username: 'alice', exists: true, on_roster: false, on_staff: false },
        ]);
        done();
      }));
    });
    
    it('should include nonexistent users', done => {
      omni.users([ 'zach', 'bob', 'staffer' ], bail(done, result => {
        result.should.read([
          { username: 'zach', exists: false, on_roster: false, on_staff: false },
          { username: 'bob', exists: true, on_roster: false, on_staff: false },
          { username: 'staffer', exists: false, on_roster: false, on_staff: true },
        ]);
        done();
      }));
    });
  });
  
  describe('#keys()', () => {
    
    beforeEach(done => {
      async.series([
        cb => omni.add('tester', 'alice', '/test/alpha', now, 100, cb),
        cb => omni.add('tester', 'alice', '/test/gamma', t_plus(now, 1), 50, cb),
        cb => omni.compute('/test', 'beta', [ 'alpha' ], alpha => alpha / 2, cb),
        cb => omni.compute('/test', 'delta', [ 'alpha', 'gamma' ], (alpha, gamma) => alpha + gamma, cb),
        cb => omni.active('/test/alpha', now, cb),
        cb => omni.visible('/test/beta', now, cb),
      ], done);
    });
    
    it('should return keys in order', done => {
      omni.keys([ '/test/alpha', '/test/beta', '/test/delta' ], bail(done, result => {
        result.should.read([
          { key: '/test/alpha', active: true, visible: false },
          { key: '/test/beta', active: false, visible: true },
          { key: '/test/delta', active: false, visible: false },
        ]);
        done();
      }));
    });
    
    it('should return inputs and outputs', done => {
      omni.keys([ '/test/alpha', '/test/delta' ], bail(done, result => {
        result.should.read([
          { key: '/test/alpha', inputs: [], outputs: [ '/test/beta', '/test/delta' ] },
          { key: '/test/delta', inputs: [ '/test/alpha', '/test/gamma' ], outputs: [] },
        ]);
        done();
      }));
    });
    
    it('should include nonexistent keys', done => {
      omni.keys([ '/test/epsilon', '/test/gamma', '/test/omega' ], bail(done, result => {
        result.should.read([
          { key: '/test/epsilon', exists: false },
          { key: '/test/gamma', exists: true },
          { key: '/test/omega', exists: false },
        ]);
        done();
      }));
    });
  });
  
  describe('#active()', () => {
    
    beforeEach(done => {
      async.series([
        cb => omni.visible('/test/*', now, cb),
      ], done);
    });
    
    it('should set keys to active', done => {
      async.series([
        cb => omni.active('/test/*', now, cb),
        cb => omni.add('tester', 'alice', '/test/alpha', now, 100, cb),
        cb => omni.get({ username: 'alice', key: '/test/alpha' }, cb),
      ], bail(done, results => {
        results[2].should.read([ { active: true } ]);
        done();
      }));
    });
    
    it('should update keys to active', done => {
      async.series([
        cb => omni.add('tester', 'alice', '/test/alpha', now, 100, cb),
        cb => omni.get({ username: 'alice', key: '/test/alpha' }, cb),
        cb => omni.active('/test/a*', now, cb),
        cb => omni.get({ username: 'alice', key: '/test/alpha' }, cb),
      ], bail(done, results => {
        results[1].should.read([ { active: false } ]);
        results[3].should.read([ { active: true } ]);
        done();
      }));
    });
  });
  
  describe('#visible()', () => {
    
    it('should set keys to visible', done => {
      async.series([
        cb => omni.visible('/test/*', now, cb),
        cb => omni.add('tester', 'alice', '/test/alpha', now, 100, cb),
        cb => omni.get({ username: 'alice', key: '/test/alpha' }, cb),
      ], bail(done, results => {
        results[2].should.read([ { visible: true } ]);
        done();
      }));
    });
    
    it('should update keys to visible', done => {
      async.series([
        cb => omni.add('tester', 'alice', '/test/alpha', now, 100, cb),
        cb => omni.get({ username: 'alice', key: '/test/alpha' }, cb),
        cb => omni.visible('/test/a*', now, cb),
        cb => omni.get({ username: 'alice', key: '/test/alpha' }, cb),
      ], bail(done, results => {
        results[1].should.read([]);
        results[3].should.read([ { visible: true } ]);
        done();
      }));
    });
  });
  
  describe('#deadline()', () => {
    
    let deadline = t_plus(now, 1);
    let penalty_id = 'no-credit';
    
    beforeEach(done => {
      async.series([
        cb => omni.penalty(penalty_id, 'No credit', () => 0, cb),
      ], done);
    });
    
    it('should add deadline with no wildcards', done => {
      async.series([
        cb => omni.deadline('/test/a', deadline, penalty_id, cb),
        cb => omni.add('tester', 'alice', '/test/a', now, 100, cb),
        cb => omni.get({ hidden: true }, cb),
      ], bail(done, results => {
        results[2].should.read([
          { username: 'alice', key: '/test/a', ts: now, value: 100, deadline, penalty_id },
        ]);
        done();
      }));
    });
    
    it('should add deadline with wildcards', done => {
      async.series([
        cb => omni.deadline('/test/*/b/*', deadline, penalty_id, cb),
        cb => omni.add('tester', 'alice', '/test/a/b/c', now, 100, cb),
        cb => omni.get({ hidden: true }, cb),
      ], bail(done, results => {
        results[2].should.read([
          { username: 'alice', key: '/test/a/b/c', ts: now, value: 100, deadline, penalty_id },
        ]);
        done();
      }));
    });
  });
  
  describe('#compute()', () => {
    
    beforeEach(done => {
      async.series([
        cb => omni.active('/test/rules/*/d', now, cb),
        cb => omni.active('/test/rules/d', now, cb),
      ], done);
    });
    
    it('should add compute rule with no wildcards', done => {
      async.series([
        cb => omni.compute('/test/rules', 'a/b', [ 'c/d' ], d => 'hi ' + d, cb),
        cb => omni.add('tester', 'alice', '/test/rules/c/d', now, 'bob', cb),
        cb => omni.get({ hidden: true }, cb),
      ], bail(done, results => {
        results[2].should.read([
          { key: '/test/rules/a/b', value: 'hi bob' },
          { key: '/test/rules/c/d', value: 'bob' },
        ]);
        done();
      }));
    });
    
    it('should add compute rule with wildcard base', done => {
      async.series([
        cb => omni.compute('/test/*', 'a', [ 'd' ], d => 'hi ' + d, cb),
        cb => omni.add('tester', 'alice', '/test/rules/d', now, 'bob', cb),
        cb => omni.get({ hidden: true }, cb),
      ], bail(done, results => {
        results[2].should.read([
          { key: '/test/rules/a', value: 'hi bob' },
          { key: '/test/rules/d', value: 'bob' },
        ]);
        done();
      }));
    });
    
    it('should add compute rule with wildcard input', done => {
      async.series([
        cb => omni.compute('/test/rules', 'a', [ 'c/*' ], d => 'hi ' + d, cb),
        cb => omni.add('tester', 'alice', '/test/rules/c/d', now, 'bob', cb),
        cb => omni.get({ hidden: true }, cb),
      ], bail(done, results => {
        results[2].should.read([
          { key: '/test/rules/a', value: 'hi bob' },
          { key: '/test/rules/c/d', value: 'bob' },
        ]);
        done();
      }));
    });
    
    it('should add compute rule with wildcard base and input', done => {
      async.series([
        cb => omni.compute('/*/rules', 'a/b', [ 'c/*', '*/d' ], (d1, d2) => 'hi ' + d1 + '/' + d2, cb),
        cb => omni.add('tester', 'alice', '/test/rules/c/d', now, 'bob', cb),
        cb => omni.get({ hidden: true }, cb),
      ], bail(done, results => {
        results[2].should.read([
          { key: '/test/rules/a/b', value: 'hi bob/bob' },
          { key: '/test/rules/c/d', value: 'bob' },
        ]);
        done();
      }));
    });
    
    describe('environment', () => {
      
      function testEnvironment(fn) {
        return done => async.series([
          cb => omni.compute('/test/*', 'a', [ '*/*', 'd' ], fn, cb),
          cb => omni.multiadd('tester', [
            { username: 'bob', key: '/test/rules/b/d', ts: now, value: 'foo' },
            { username: 'alice', key: '/test/rules/c/b', ts: now, value: 'x' },
            { username: 'alice', key: '/test/rules/c/d', ts: now, value: 'y' },
            { username: 'alice', key: '/test/rules/d', ts: now, value: 'z' },
          ], cb),
          cb => omni.get({ username: 'alice', hidden: true}, cb),
        ], done);
      }
      
      it('should supply arguments', testEnvironment((cd, d) => {
        assert.deepEqual(cd, [ null, 'y' ]);
        assert.equal(d, 'z');
      }));
      
      it('should supply rows', testEnvironment((cd, d) => {
        rows.should.read({
          '/test/rules/*/*': [ { key: '/test/rules/b/d', value: null }, { key: '/test/rules/c/d', value: 'y' } ],
          '/test/rules/d': [ { key: '/test/rules/d', value: 'z' } ],
        });
      }));
      
      it('should supply arguments', testEnvironment((cd, d) => {
        sum.should.be.a.Function();
        assert.equal(sum([ 1, 3, 5 ]), 9);
        assert.equal(sum([]), 0);
      }));
    });
  });
  
  describe('#cron()', () => {
    
    beforeEach(done => {
      async.series([
        cb => omni.add('tester', 'alice', '/test/x', now, 0, cb),
      ], done);
    });
    
    it('should update keys to active', done => {
      async.series([
        cb => omni.active('/test/*', new Date(Date.now() + 40), cb),
        cb => omni.get({ hidden: true }, cb),
        cb => setTimeout(cb, 50),
        cb => omni.cron(cb),
        cb => omni.get({ hidden: true }, cb),
      ], bail(done, results => {
        results[1].should.read([ { active: false } ]);
        results[4].should.read([ { active: true } ]);
        done();
      }));
    });
    
    it('should update keys to visible', done => {
      async.series([
        cb => omni.visible('/test/*', new Date(Date.now() + 40), cb),
        cb => omni.get({ hidden: true }, cb),
        cb => setTimeout(cb, 50),
        cb => omni.cron(cb),
        cb => omni.get({ hidden: true }, cb),
      ], bail(done, results => {
        results[1].should.read([ { visible: false } ]);
        results[4].should.read([ { visible: true } ]);
        done();
      }));
    });
  });
});
