'use strict';

const fs = require('fs');
const crypto = require('crypto');
const util = require('util');

const async = require('async');
const should = require('should');
const sinon = require('sinon');

const config = require('../config');
const omnivore = require('../src/omnivore');

describe('Omnivore', function() {
  
  let sandbox = sinon.sandbox.create();
  
  let omni = new omnivore.Omnivore('TEST.OMNIVORE/ia00', config, true);
  let now = new Date();
  
  let ready = new Promise(resolve => omni.once('ready', resolve));
  before(done => { ready.then(done) });
  after(done => omni.close(done));
  
  beforeEach(done => {
    omni.pg((client, done) => {
      async.series([
        cb => client.query(fixtures('destroy'), cb),
        cb => client.query(fixtures('create'), cb),
        cb => client.query(fixtures('base'), cb),
      ], done);
    }, done);
  });
  
  afterEach(() => sandbox.restore());
  
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
        cb => omni.visible('/test/alpha|beta|gamma|delta', now, cb),
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
    
    it('should return data concurrently', done => {
      let step = () => { step = done };
      let callback = bail(done, rows => {
        rows.should.read([ { value: 100 } ]);
        step();
      });
      omni.get({ username: 'alice', key: '/test/alpha' }, callback);
      omni.get({ username: 'alice', key: '/test/alpha' }, callback);
    });
    
    it('should return same data after initial', done => {
      async.series([
        cb => omni.get({ username: 'alice', key: '/test/alpha' }, cb),
        cb => omni.get({ username: 'alice', key: '/test/alpha' }, cb),
      ], bail(done, results => {
        results[0].should.eql(results[1]);
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
      
      it('should return computed concurrently', done => {
        omni.get({ username: 'alice', key: '/test/alpha' }, bail(done, () => {
          let step = () => { step = done };
          let callback = bail(done, rows => {
            rows.should.read([ { value: 50 } ]);
            step();
          });
          omni.get({ username: 'alice', key: '/test/beta' }, callback);
          omni.get({ username: 'alice', key: '/test/beta' }, callback);
        }));
      });
      
      it('should return same computed after initial', done => {
        async.series([
          cb => omni.get({ username: 'alice', key: '/test/beta' }, cb),
          cb => omni.get({ username: 'alice', key: '/test/beta' }, cb),
        ], bail(done, results => {
          results[0].should.eql(results[1]);
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
    
    context('no inputs', () => {
      
      beforeEach(done => {
        async.series([
          cb => omni.compute('/test', 'gamma', [], () => 42, cb),
        ], done);
      });
      
      it('should return output', done => {
        omni.get({ username: 'alice', key: '/test/gamma' }, bail(done, rows => {
          rows.should.read([ { username: 'alice', key: '/test/gamma', value: 42 } ]);
          done();
        }));
      });
      
      it('should return output using current timestamp', done => {
        let start = new Date();
        omni.get({ username: 'alice', key: '/test/gamma' }, bail(done, rows => {
          let end = new Date();
          rows[0].should.read({ username: 'alice', key: '/test/gamma' });
          rows[0].ts.should.be.greaterThanOrEqual(start).and.lessThanOrEqual(end);
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
      
      it('should return same computed after initial', done => {
        async.series([
          cb => omni.get({ username: 'alice', key: '/test/gamma' }, cb),
          cb => omni.get({ username: 'alice', key: '/test/gamma' }, cb),
        ], bail(done, results => {
          results[0].should.eql(results[1]);
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
          cb => omni.compute('/test', 'gamma', [ 'delta/*', 'epsilon/*' ], (a, b) => `${a};${b}`, cb),
          cb => omni.active('/test/*/2', now, cb),
          cb => omni.visible('/test/*', now, cb),
          cb => omni.add('tester', 'alice', '/test/delta/1', now, 'A1', cb),
          cb => omni.add('tester', 'alice', '/test/delta/2', now, 'A2', cb),
          cb => omni.add('tester', 'alice', '/test/epsilon/1', now, 'B1', cb),
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
      
      beforeEach(done => {
        async.series([
          cb => omni.add('tester', 'alice', '/test/aleph', now, 100, cb),
          cb => omni.add('tester', 'bob', '/test/aleph', now, 80, cb),
          cb => omni.compute('/test', 'bet', [ 'aleph' ], alpha => alpha / 2, cb),
          cb => omni.active('/test/aleph', now, cb),
        ], done);
      });
      
      it('should not return hidden data', done => {
        async.series([
          cb => omni.get({ username: 'alice', key: '/test/aleph', hidden: true }, cb),
          cb => omni.get({ username: 'alice', key: '/test/aleph' }, cb),
        ], bail(done, results => {
          results.should.read([ [ { username: 'alice', value: 100 } ], [] ]);
          done();
        }));
      });
      
      it('should not return hidden output', done => {
        async.series([
          cb => omni.get({ username: 'alice', key: '/test/bet', hidden: true }, cb),
          cb => omni.get({ username: 'alice', key: '/test/bet' }, cb),
        ], bail(done, results => {
          results.should.read([ [ { username: 'alice', value: 50 } ], [] ]);
          done();
        }));
      });
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
    });
    
    context('intrinsic', () => {
      
      it('should not include unspecified intrinsics', done => {
        omni.get({ hidden: true }, bail(done, results => {
          results.filter(row => row.key.startsWith('/-/')).should.eql([]);
          done();
        }));
      });
      
      it('should include specified intrinsic', done => {
        omni.get({ key: '/-/userinfo', hidden: true }, bail(done, results => {
          results.should.read([
            { username: 'alice', key: '/-/userinfo' },
            { username: 'bob', key: '/-/userinfo' },
          ]);
          done();
        }));
      });
    });
  });
  
  describe('#stream()', () => {
    
    beforeEach(done => {
      async.series([
        cb => omni.add('tester', 'alice', '/test/alpha', now, 100, cb),
        cb => omni.add('tester', 'bob', '/test/alpha', now, 80, cb),
        cb => omni.compute('/test', 'beta', [ 'alpha' ], alpha => alpha / 2, cb),
        cb => omni.active('/test/alpha', now, cb),
        cb => omni.visible('/test/alpha|beta|gamma|delta', now, cb),
      ], done);
    });
    
    it('should return data for user + key', done => {
      omni.stream({ username: 'alice', key: '/test/alpha' }, bail(done, (pre_rows, emitter) => {
        pre_rows.should.read([
          { username: 'alice', key: '/test/alpha', ts: null, value: null },
        ]);
        let expected = [
          { username: 'alice', key: '/test/alpha', ts: now, value: 100 },
        ];
        let found = [];
        emitter.on('rows', post_rows => found.push(...post_rows));
        emitter.on('end', () => {
          found.should.read(expected);
          done();
        });
      }));
    });
    
    it('should return all data for key', done => {
      omni.stream({ key: '/test/alpha' }, bail(done, (pre_rows, emitter) => {
        pre_rows.should.read([
          { username: 'alice', key: '/test/alpha', ts: null, value: null },
          { username: 'bob', key: '/test/alpha', ts: null, value: null },
        ]);
        let expected = [
          { username: 'alice', key: '/test/alpha', ts: now, value: 100 },
          { username: 'bob', key: '/test/alpha', ts: now, value: 80 },
        ];
        let found = [];
        emitter.on('rows', post_rows => found.push(...post_rows));
        emitter.on('end', () => {
          found.sort().should.read(expected);
          done();
        });
      }));
    });
    
    it('should return available data', done => {
      omni.get({ username: 'bob', key: '/test/beta' }, bail(done, () => {
        omni.stream({ username: 'bob', key: '/test/beta' }, bail(done, (pre_rows, emitter) => {
          pre_rows.should.read([
            { username: 'bob', key: '/test/beta', ts: now, value: 40 },
          ]);
          should.not.exist(emitter);
          done();
        }));
      }));
    });
    
    it('should emit unavailable data', done => {
      omni.get({ username: 'bob', key: '/test/beta' }, bail(done, () => {
        omni.stream({ key: '/test/beta' }, bail(done, (pre_rows, emitter) => {
          pre_rows.should.read([
            { username: 'alice', key: '/test/beta', ts: null, value: null },
            { username: 'bob', key: '/test/beta', ts: now, value: 40 },
          ]);
          let found = [];
          emitter.on('rows', post_rows => found.push(...post_rows));
          emitter.on('end', () => {
            found.should.read([
              { username: 'alice', key: '/test/beta', ts: now, value: 50 },
            ]);
            done();
          });
        }));
      }));
    });
    
    it('should return data concurrently', done => {
      let step = () => { step = done };
      let callback = bail(done, (pre_rows, emitter) => {
        pre_rows.should.read([ { value: null } ]);
        emitter.on('rows', post_rows => post_rows.should.read([ { value: 100 }]));
        emitter.on('end', () => step());
      });
      omni.stream({ username: 'alice', key: '/test/alpha' }, callback);
      omni.stream({ username: 'alice', key: '/test/alpha' }, callback);
    });
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
    
    it('should not return hidden data');
    
    it('should not return hidden output');
    
    it('should limit users to roster');
  });
  
  describe('#multistream()', () => {
    
    beforeEach(done => {
      async.series([
        cb => omni.add('tester', 'yolanda', '/test/beta', now, 30, cb),
        cb => omni.add('tester', 'zach', '/test/gamma', now, 0, cb),
        cb => omni.add('tester', 'alice', '/test/alpha', now, 100, cb),
        cb => omni.add('tester', 'bob', '/test/alpha', now, 80, cb),
        cb => omni.compute('/test', 'beta', [ 'alpha' ], alpha => alpha / 2, cb),
        cb => omni.active('/test/alpha', now, cb),
        cb => omni.visible('/test/*', now, cb),
      ], done);
    });
    
    it('should return values for user + keys', done => {
      omni.multistream([ '/test/alpha', '/test/beta' ], { username: 'alice' }, bail(done, (pre_rows, emitter) => {
        pre_rows.should.read([
          { username: 'alice', '/test/alpha': undefined, '/test/beta': undefined },
        ]);
        let expected = [
          { username: 'alice', '/test/alpha': { value: 100 }, '/test/beta': { value: 50 } },
        ];
        let found = [];
        emitter.on('rows', post_rows => found.push(...post_rows));
        emitter.on('end', () => {
          found.should.read(expected);
          done();
        });
      }));
    });
    
    it('should return values for keys', done => {
      omni.multistream([ '/test/alpha', '/test/beta' ], {}, bail(done, (pre_rows, emitter) => {
        pre_rows.should.read([
          { username: 'alice', '/test/alpha': undefined, '/test/beta': undefined },
          { username: 'bob', '/test/alpha': undefined, '/test/beta': undefined },
          { username: 'yolanda', '/test/alpha': { value: null }, '/test/beta': undefined },
          { username: 'zach', '/test/alpha': { value: null }, '/test/beta': undefined },
        ]);
        let expected = [
          { username: 'alice', '/test/alpha': { value: 100 }, '/test/beta': { value: 50 } },
          { username: 'bob', '/test/alpha': { value: 80 }, '/test/beta': { value: 40 } },
          { username: 'yolanda', '/test/alpha': { value: null }, '/test/beta': { value: 30 } },
          { username: 'zach', '/test/alpha': { value: null }, '/test/beta': { value: 0 } },
        ];
        let found = [];
        emitter.on('rows', post_rows => found.push(...post_rows));
        emitter.on('end', () => {
          found.should.read(expected);
          done();
        });
      }));
    });
    
    it('should return available data', done => {
      omni.get({ username: 'bob', key: '/test/beta' }, bail(done, () => {
        omni.multistream([ '/test/beta' ], { username: 'bob' }, bail(done, (pre_rows, emitter) => {
          pre_rows.should.read([
            { username: 'bob', '/test/beta': { value: 40 } },
          ]);
          should.not.exist(emitter);
          done();
        }));
      }));
    });
    
    it('should emit all data', done => {
      omni.get({ username: 'bob', key: '/test/beta' }, bail(done, () => {
        omni.multistream([ '/test/beta' ], {}, bail(done, (pre_rows, emitter) => {
          pre_rows.should.read([
            { username: 'alice', '/test/beta': undefined },
            { username: 'bob', '/test/beta': { value: 40 } },
            { username: 'yolanda', '/test/beta': undefined },
            { username: 'zach', '/test/beta': undefined },
            ]);
          let found = [];
          emitter.on('rows', post_rows => found.push(...post_rows));
          emitter.on('end', () => {
            found.should.read([
              { username: 'alice', '/test/beta': { value: 50 } },
              { username: 'bob', '/test/beta': { value: 40 } },
              { username: 'yolanda', '/test/beta': { value: 30 } },
              { username: 'zach', '/test/beta': { value: 0 } },
            ]);
            done();
          });
        }));
      }));
    });
    
    it('should return data concurrently', done => {
      let step = () => { step = done };
      let callback = bail(done, (pre_rows, emitter) => {
        pre_rows.should.read([ { '/test/beta': undefined } ]);
        emitter.on('rows', post_rows => post_rows.should.read([ { '/test/beta': { value: 0 } } ]));
        emitter.on('end', () => step());
      });
      omni.multistream([ '/test/beta' ], { username: 'zach' }, callback);
      omni.multistream([ '/test/beta' ], { username: 'zach' }, callback);
    });
  });
  
  describe('#children()', () => {
    
    beforeEach(done => {
      async.series([
        cb => omni.pg((client, done) => client.query(fixtures('small'), done), cb),
        cb => omni.add('nanoquizzer', 'alice', '/test/class-3/nanoquiz', now, 7, cb),
      ], done);
    });
    
    it('should return values for user + key', done => {
      omni.children({ username: 'alice', key: '/test/class-3', hidden: true }, bail(done, rows => {
        rows.should.read([ { username: 'alice', key: '/test/class-3/nanoquiz', value: 7 } ]);
        done();
      }));
    });
    
    it('should return values for user');
    
    it('should return values for key');
    
    it('should not return hidden values', done => {
      omni.children({ username: 'alice', key: '/test/class-3' }, bail(done, rows => {
        rows.should.read([]);
        done();
      }));
    });
  });
  
  describe('#grandchildren()', () => {
    
    beforeEach(done => {
      async.series([
        cb => omni.pg((client, done) => client.query(fixtures('small'), done), cb),
        cb => omni.meta('/test/*/nanoquiz', { promotion: 1 }, cb),
        cb => omni.meta('/test/class-2/nanoquiz', { promotion: 2 }, cb),
        cb => omni.add('tester', 'alice', '/test/class-3/nanoquiz', now, 7, cb),
      ], done);
    });
    
    it('should include promotion to subdir', done => {
      omni.grandchildren({ username: 'alice', key: '/test', hidden: true }, bail(done, rows => {
        rows.should.read([
          { key: '/test/class-1/nanoquiz', value: 10 },
          { key: '/test/class-2/nanoquiz', value: 8 },
          { key: '/test/class-3/nanoquiz', value: 7 },
        ]);
        done();
      }));
    });
    
    it('should include promotion to root', done => {
      omni.grandchildren({ username: 'alice', key: '/' }, bail(done, rows => {
        rows.should.read([ { key: '/test/class-2/nanoquiz', value: 8 } ]);
        done();
      }));
    });
    
    it('should return values in order', done => {
      async.series([
        cb => omni.meta('/test/*/*/important', { promotion: 2 }, cb),
        cb => omni.add('tester', 'alice', '/test/class-2/super/important', now, true, cb),
        cb => omni.add('tester', 'alice', '/test/class-3/also/important', now, true, cb),
        cb => omni.grandchildren({ username: 'alice', key: '/test', hidden: true }, cb),
      ], bail(done, results => {
        results[3].should.read([
          { key: '/test/class-1/nanoquiz' },
          { key: '/test/class-2/super/important' },
          { key: '/test/class-2/nanoquiz' },
          { key: '/test/class-3/also/important' },
          { key: '/test/class-3/nanoquiz' },
        ]);
        done();
      }));
    });
    
    it('should not return hidden values', done => {
      omni.grandchildren({ username: 'alice', key: '/test' }, bail(done, rows => {
        rows.should.read([
          { key: '/test/class-1/nanoquiz' }, { key: '/test/class-2/nanoquiz' },
        ]);
        done();
      }));
    });
  });
  
  describe('#dirs()', () => {
    
    beforeEach(done => {
      async.series([
        cb => omni.pg((client, done) => client.query(fixtures('small'), done), cb),
        cb => omni.add('tester', 'alice', '/test/class-3/nanoquiz', now, 7, cb),
        cb => omni.add('tester', 'bob', '/test/class-1/-/unnanoquiz', now, -3, cb),
        cb => omni.add('root', 'alice', '/-/secret', now, 0, cb),
      ], done);
    });
    
    it('should return subdirs of root', done => {
      omni.dirs({ key: '/', hidden: true }, bail(done, rows => {
        rows.should.read([ { key: '/test' } ]);
        done();
      }));
    });
    
    it('should return subdirs of dir', done => {
      omni.dirs({ key: '/test', hidden: true }, bail(done, rows => {
        rows.should.read([ { key: '/test/class-1' }, { key: '/test/class-2' }, { key: '/test/class-3' } ]);
        done();
      }));
    });
    
    it('should not return subdirs of all hidden values', done => {
      omni.dirs({ key: '/test' }, bail(done, rows => {
        rows.should.read([ { key: '/test/class-1' }, { key: '/test/class-2' } ]);
        done();
      }));
    });
    
    it('should not return no-name subdir of dir', done => {
      omni.dirs({ key: '/test/class-1', hidden: true }, bail(done, rows => {
        rows.should.read([]);
        done();
      }));
    });
  });
  
  describe('#leaves()', () => {
    
    beforeEach(done => {
      async.series([
        cb => omni.pg((client, done) => client.query(fixtures('small'), done), cb),
        cb => omni.add('tester', 'alice', '/test/class-3/nanoquiz', now, 7, cb),
        cb => omni.add('root', 'alice', '/secret', now, 0, cb),
      ], done);
    });
    
    it('should return children of root', done => {
      omni.leaves({ key: '/', hidden: true }, bail(done, rows => {
        rows.should.read([ { key: '/secret' } ]);
        done();
      }));
    });
    
    it('should return children of dir', done => {
      omni.leaves({ key: '/test/class-3', hidden: true }, bail(done, rows => {
        rows.should.read([ { key: '/test/class-3/nanoquiz' } ]);
        done();
      }));
    });
    
    it('should not return hidden children', done => {
      omni.leaves({ key: '/test/class-3' }, bail(done, rows => {
        rows.should.read([]);
        done();
      }));
    });
  });
  
  describe('#findKeys()', () => {
    
    it('should return keys');
    
    it('should not return hidden keys');
  });
  
  describe('#history()', () => {
    
    beforeEach(done => {
      async.series([
        cb => omni.add('tester', 'alice', '/test/alpha', now, 80, cb),
        cb => omni.add('tester', 'bob', '/test/alpha', now, 100, cb),
        cb => omni.add('tester', 'bob', '/test/gamma', now, 70, cb),
        cb => omni.compute('/test', 'beta', [ 'alpha' ], alpha => alpha / 2, cb),
        cb => omni.compute('/test', 'delta', [ 'alpha' ], alpha => alpha * 2, cb),
        cb => omni.active('/test/*', now, cb),
        cb => omni.visible('/test/alpha|beta', now, cb),
        cb => omni.multiget([ 'test/alpha', '/test/beta', 'test/gamma', 'test/delta' ], { hidden: true }, cb),
        cb => omni.add('tester', 'alice', '/test/alpha', t_plus(now, 1), 90, cb),
        cb => omni.add('tester', 'bob', '/test/beta', t_plus(now, 1), 10, cb),
      ], done);
    });
    
    it('should return history for user + key', done => {
      omni.history({ username: 'alice', key: '/test/alpha' }, bail(done, rows => {
        rows.should.read([
          { username: 'alice', ts: t_plus(now, 1), value: 90, raw: true },
          { username: 'alice', ts: now, value: 80, raw: false },
          { username: 'alice', ts: now, value: 80, raw: true },
        ]);
        done();
      }));
    });
    
    it('should return all history for data', done => {
      omni.history({ key: '/test/alpha' }, bail(done, rows => {
        rows.should.read([
          { username: 'alice', ts: t_plus(now, 1), value: 90, raw: true },
          { username: 'alice', ts: now, value: 80, raw: false },
          { username: 'alice', ts: now, value: 80, raw: true },
          { username: 'bob', ts: now, value: 100, raw: false },
          { username: 'bob', ts: now, value: 100, raw: true },
        ]);
        done();
      }));
    });

    it('should return current history for output', done => {
      omni.history({ key: '/test/beta' }, bail(done, rows => {
        rows.should.read([
          { username: 'bob', ts: t_plus(now, 1), value: 10, raw: true },
        ]);
        done();
      }));
    });
    
    it('should not return hidden data or output', done => {
      async.series([
        cb => omni.history({ key: '/test/gamma', hidden: true }, cb),
        cb => omni.history({ key: '/test/gamma' }, cb),
        cb => omni.history({ key: '/test/delta', hidden: true }, cb),
        cb => omni.history({ key: '/test/delta' }, cb),
      ], bail(done, results => {
        results.should.read([
          [ { username: 'bob', value: 70 }, { username: 'bob', value: 70 } ],
          [],
          [ { username: 'bob', value: 200 } ],
          [],
        ]);
        done();
      }));
    });
    
    it('should only return raw data', done => {
      async.series([
        cb => omni.history({ key: '/test/alpha', only_raw: true }, cb),
        cb => omni.history({ key: '/test/beta', only_raw: true }, cb),
      ], bail(done, results => {
        results.should.read([
          [
            { username: 'alice', value: 90 },
            { username: 'alice', value: 80 },
            { username: 'bob', value: 100 }
          ],
          [ { username: 'bob', value: 10 } ],
        ]);
        done();
      }));
    });
  });
  
  describe('#agent()', () => {
    
    it('should return agent', done => {
      omni.agent('tester', bail(done, result => {
        result.should.read({
          agent: 'tester',
          public_key: /PUBLIC KEY/,
          add: [ '/test/**' ],
          write: [ '/test/**', '/extra/**' ],
        });
        done();
      }));
    });
    
    it('should memoize agent', done => {
      async.series([
        cb => omni.memo.agent('tester', cb),
        cb => { sandbox.stub(omni, 'agent').throws(); cb(); },
        cb => omni.memo.agent('tester', cb),
      ], bail(done, results => {
        results[0].should.read({ agent: 'tester' });
        results[2].should.read({ agent: 'tester' });
        done();
      }));
    });
  });
  
  describe('#addAgent()', () => {
    
    it('should add agent', done => {
      async.series([
        cb => omni.addAgent('newagent', 'KEY', [ '/**' ], [ '/**' ], cb),
        cb => omni.agent('newagent', cb),
      ], bail(done, results => {
        results[1].should.read({
          agent: 'newagent',
          public_key: 'KEY',
          add: [ '/**' ],
          write: [ '/**' ],
        });
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
  
  describe('#addStaff()', () => {
    
    it('should add staff', done => {
      async.series([
        cb => omni.addStaff('newstaffer', cb),
        cb => omni.allStaff(cb),
      ], bail(done, results => {
        results[1].should.read(new Set([ 'staffer', 'newstaffer' ]));
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
    
    it('should include user info', done => {
      let info = { givenName: 'Alice' };
      async.series([
        cb => omni.add('root', 'alice', '/-/userinfo', now, info, cb),
        cb => omni.allUsers(cb),
      ], bail(done, results => {
        results[1].should.read([
          { username: 'alice', value: info }, { username: 'bob', value: {} },
        ]);
        done();
      }));
    });
  });
  
  describe('#streamAllUsers()', () => {
    
    let info = { givenName: 'Alice' };
    
    beforeEach(done => {
      async.series([
        cb => omni.add('tester', 'alice', '/test/alpha', now, 10, cb),
        cb => omni.add('tester', 'bob', '/test/beta', now, 20, cb),
        cb => omni.add('root', 'alice', '/-/userinfo', now, info, cb),
      ], done);
    });
    
    it('should return users with info', done => {
      omni.streamAllUsers(bail(done, (pre_rows, emitter) => {
        pre_rows.should.read([
          { username: 'alice', value: null }, { username: 'bob', value: null },
        ]);
        let expected = [
          { username: 'alice', value: info }, { username: 'bob', value: {} },
        ];
        let found = [];
        emitter.on('rows', post_rows => found.push(...post_rows));
        emitter.on('end', () => {
          found.should.read(expected);
          done();
        });
      }));
    });
  });
  
  describe('#user()', () => {
    
    beforeEach(done => {
      async.series([
        cb => omni.add('tester', 'alice', '/test/alpha', now, 10, cb),
      ], done);
    });
    
    it('should return user', done => {
      omni.user('alice', bail(done, result => {
        result.should.read({ username: 'alice', exists: true, on_roster: false, on_staff: false });
        done();
      }));
    });
    
    it('should return staff user', done => {
      omni.user('staffer', bail(done, result => {
        result.should.read({ username: 'staffer', exists: false, on_roster: false, on_staff: true });
        done();
      }));
    });
    
    it('should return nonexistent user', done => {
      omni.user('zach', bail(done, result => {
        result.should.read({ username: 'zach', exists: false, on_roster: false, on_staff: false });
        done();
      }));
    });
    
    it('should memoize user', done => {
      async.series([
        cb => omni.memo.user('alice', cb),
        cb => { sandbox.stub(omni, 'user').throws(); cb(); },
        cb => omni.memo.user('alice', cb),
      ], bail(done, results => {
        results[0].should.read({ username: 'alice' });
        results[2].should.read({ username: 'alice' });
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
  
  describe('#setRoster()', () => {
    
    it('should add users', done => {
      async.series([
        cb => omni.setRoster('tester', [ 'alice' ], cb),
        cb => omni.allUsers(cb),
      ], bail(done, results => {
        results[1].should.read([ { username: 'alice', on_roster: true } ]);
        done();
      }));
    });
    
    it('should add to and remove from roster', done => {
      async.series([
        cb => omni.multiadd('tester', [ 'alice', 'bob', 'yolanda', 'zach' ].map(username => {
          return { username, key: '/test/alpha', ts: now, value: 10 };
        }), cb),
        cb => omni.setRoster('tester', [ 'alice', 'bob' ], cb),
        cb => omni.allUsers(cb),
        cb => omni.setRoster('tester', [ 'yolanda', 'bob' ], cb),
        cb => omni.allUsers(cb),
      ], bail(done, results => {
        results[2].should.read([
          { username: 'alice', on_roster: true },
          { username: 'bob', on_roster: true },
          { username: 'yolanda', on_roster: false },
          { username: 'zach', on_roster: false },
        ]);
        results[4].should.read([
          { username: 'bob', on_roster: true },
          { username: 'yolanda', on_roster: true },
          { username: 'alice', on_roster: false },
          { username: 'zach', on_roster: false },
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
  
  describe('#rules()', () => {
    
    let penalty_id = 'no-credit';
    
    beforeEach(done => {
      async.series([
        cb => omni.active('/test/**', now, cb),
        cb => omni.visible('/test/**', now, cb),
        cb => omni.penalty(penalty_id, 'No credit', () => 0, cb),
        cb => omni.deadline('/test/**', now, penalty_id, cb),
        cb => omni.meta('/test/*/b', { key_order: 2 }, cb),
        cb => omni.compute('/test/*', 'b', [ 'a' ], () => null, cb),
        cb => omni.compute('/test/*', 'c', [ 'b' ], () => null, cb),
      ], done);
    });
    
    it('should return agent rules', done => {
      omni.rules('/test/q/b', bail(done, result => {
        result.should.read({
          creators: [ { agent: 'root' }, { agent: 'tester' } ],
          writers: [ { agent: 'root' }, { agent: 'tester' } ],
        });
        done();
      }));
    });
    
    it('should return key rules', done => {
      omni.rules('/test/q/b', bail(done, result => {
        result.should.read({
          active: [ { keys: '/test/**' } ],
          visible: [ { keys: '/test/**' } ],
          deadline: [ { keys: '/test/**', penalty_id: 'no-credit' } ],
          rules: [ { keys: '/test/*/b', key_order: 2 } ],
        });
        done();
      }));
    });
    
    it('should return computation rules', done => {
      omni.rules('/test/q/b', bail(done, result => {
        result.should.read({
          computed: [ { base: '/test/*', output: '/b' } ],
          computes: [ { base: '/test/*', output: '/c' } ],
        });
        done();
      }));
    });
    
    it('should return computation rules with empty base', done => {
      async.series([
        cb => omni.active('/test/**', now, cb),
        cb => omni.compute('', 'test/b', [ 'test/a' ], () => null, cb),
        cb => omni.compute('', 'test/c', [ 'test/b' ], () => null, cb),
        cb => omni.rules('/test/b', cb),
      ], bail(done, results => {
        results[3].should.read({
          computed: [ { base: '', output: '/test/b' } ],
          computes: [ { base: '', output: '/test/c' } ],
        });
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
  
  describe('#meta()', () => {
    
    it('should set promotion', done => {
      async.series([
        cb => omni.meta('/test/a/*', { promotion: 1 }, cb),
        cb => omni.add('tester', 'alice', '/test/a/b', now, 1, cb),
        cb => omni.get({ hidden: true }, cb),
      ], bail(done, results => {
        results[2].should.read([ { key: '/test/a/b', promotion: 1 } ]);
        done();
      }));
    });
    
    it('should update promotion', done => {
      async.series([
        cb => omni.add('tester', 'alice', '/test/a/b', now, 1, cb),
        cb => omni.meta('/test/a/*', { promotion: 1 }, cb),
        cb => omni.get({ hidden: true }, cb),
      ], bail(done, results => {
        results[2].should.read([ { key: '/test/a/b', promotion: 1 } ]);
        done();
      }));
    });
    
    it('should maximize promotion', done => {
      async.series([
        cb => omni.meta('/test/a/*', { promotion: 1 }, cb),
        cb => omni.meta('/test/*/b', { promotion: 2 }, cb),
        cb => omni.add('tester', 'alice', '/test/a/a', now, 1, cb),
        cb => omni.add('tester', 'alice', '/test/a/b', now, 1, cb),
        cb => omni.get({ hidden: true }, cb),
      ], bail(done, results => {
        results[4].should.read([ { key: '/test/a/a', promotion: 1 }, { key: '/test/a/b', promotion: 2 } ]);
        done();
      }));
    });
    
    it('should set order', done => {
      async.series([
        cb => omni.meta('/test/a/*', { key_order: 1 }, cb),
        cb => omni.add('tester', 'alice', '/test/a/b', now, 1, cb),
        cb => omni.get({ hidden: true }, cb),
      ], bail(done, results => {
        results[2].should.read([ { key: '/test/a/b', key_order: 1 } ]);
        done();
      }));
    });
    
    it('should update order', done => {
      async.series([
        cb => omni.add('tester', 'alice', '/test/a/b', now, 1, cb),
        cb => omni.meta('/test/a/*', { key_order: 1 }, cb),
        cb => omni.get({ hidden: true }, cb),
      ], bail(done, results => {
        results[2].should.read([ { key: '/test/a/b', key_order: 1 } ]);
        done();
      }));
    });
    
    it('should maximize order', done => {
      async.series([
        cb => omni.meta('/test/a/*', { key_order: 1 }, cb),
        cb => omni.meta('/test/*/b', { key_order: 2 }, cb),
        cb => omni.add('tester', 'alice', '/test/a/a', now, 1, cb),
        cb => omni.add('tester', 'alice', '/test/a/b', now, 1, cb),
        cb => omni.get({ hidden: true }, cb),
      ], bail(done, results => {
        results[4].should.read([ { key: '/test/a/a', key_order: 1 }, { key: '/test/a/b', key_order: 2 } ]);
        done();
      }));
    });
    
    it('should set comments', done => {
      async.series([
        cb => omni.meta('/test/a/*', { key_comment: 'y' }, cb),
        cb => omni.meta('/test/*/b', { values_comment: 'z' }, cb),
        cb => omni.add('tester', 'alice', '/test/a/b', now, 1, cb),
        cb => omni.get({ hidden: true }, cb),
      ], bail(done, results => {
        results[3].should.read([ { key: '/test/a/b', key_comment: 'y', values_comment: 'z' } ]);
        done();
      }));
    });
    
    it('should update comments', done => {
      async.series([
        cb => omni.add('tester', 'alice', '/test/a/b', now, 1, cb),
        cb => omni.meta('/test/a/*', { key_comment: 'y' }, cb),
        cb => omni.meta('/test/*/b', { values_comment: 'z' }, cb),
        cb => omni.get({ hidden: true }, cb),
      ], bail(done, results => {
        results[3].should.read([ { key: '/test/a/b', key_comment: 'y', values_comment: 'z' } ]);
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
    
    it('should add compute rule with empty base', done => {
      async.series([
        cb => omni.compute('/', 'test/rules/a', [ 'test/rules/c/*' ], d => 'go ' + d, cb),
        cb => omni.add('tester', 'alice', '/test/rules/c/d', now, 'bob', cb),
        cb => omni.get({ hidden: true }, cb),
      ], bail(done, results => {
        results[2].should.read([
          { key: '/test/rules/a', value: 'go bob' },
          { key: '/test/rules/c/d', value: 'bob' },
        ]);
        done();
      }));
    });
    
    it('should add compute rule with prefix matching');
    
    it('should add compute rule with negation', done => {
      async.series([
        cb => omni.compute('/test/!x', 'a', [ '!y/d' ], d => JSON.stringify(d), cb),
        cb => omni.add('tester', 'alice', '/test/rules/c/d', now, 'yes', cb),
        cb => omni.add('tester', 'alice', '/test/rules/y/d', now, 'no', cb),
        cb => omni.get({ hidden: true }, cb),
      ], bail(done, results => {
        results[3].should.read([
          { key: '/test/rules/a', value: '["yes"]' },
          { key: '/test/rules/c/d', value: 'yes' },
          { key: '/test/rules/y/d', value: 'no' },
        ]);
        done();
      }));
    });
    
    it('should add compute rule with alternation', done => {
      async.series([
        cb => omni.compute('/test/fools|rules|xuls', 'a', [ 'a|b|c/d' ], d => JSON.stringify(d), cb),
        cb => omni.add('tester', 'alice', '/test/rules/c/d', now, 'on', cb),
        cb => omni.add('tester', 'alice', '/test/rules/e/d', now, 'off', cb),
        cb => omni.get({ hidden: true }, cb),
      ], bail(done, results => {
        results[3].should.read([
          { key: '/test/rules/a', value: '["on"]' },
          { key: '/test/rules/c/d', value: 'on' },
          { key: '/test/rules/e/d', value: 'off' },
        ]);
        done();
      }));
    });
    
    it('should add compute rule with word matching', done => {
      async.series([
        cb => omni.compute('/test/rules%', 'a', [ 'x-y%/d' ], d => JSON.stringify(d), cb),
        cb => omni.add('tester', 'alice', '/test/rules/x/d', now, 'pictures', cb),
        cb => omni.add('tester', 'alice', '/test/rules/z-y-x/d', now, 'words', cb),
        cb => omni.get({ hidden: true }, cb),
      ], bail(done, results => {
        results[3].should.read([
          { key: '/test/rules/a', value: '["words"]' },
          { key: '/test/rules/x/d', value: 'pictures' },
          { key: '/test/rules/z-y-x/d', value: 'words' },
        ]);
        done();
      }));
    });
    
    it('should add compute rule with word prefix matching');
    
    it('should add compute rule with no inputs', done => {
      async.series([
        cb => omni.compute('/test/rules', 'a', [], () => 'cool', cb),
        cb => omni.add('tester', 'alice', '/test/unrelated/z', now, 0, cb),
        cb => omni.get({ hidden: true }, cb),
      ], bail(done, results => {
        results[2].should.read([
          { key: '/test/rules/a', value: 'cool' },
          { key: '/test/unrelated/z' },
        ]);
        done();
      }));
    });
    
    it('should not add compute rule with no inputs and wildcard base', done => {
      omni.compute('/test/*', 'a', [], () => 'not cool', (err) => {
        should.exist(err);
        omni.get({ hidden: true }, bail(done, results => {
          results.should.read([]);
          done();
        }));
      });
    });
    
    it('should add asynchronous compute rule', done => {
      async.series([
        cb => omni.compute('/test/rules', 'a/b', [ 'c/d' ], d => async(cb => {
          nextTick(() => cb(null, 'bye ' + d));
        }), cb),
        cb => omni.add('tester', 'alice', '/test/rules/c/d', now, 'bob', cb),
        cb => omni.get({ hidden: true }, cb),
      ], bail(done, results => {
        results[2].should.read([
          { key: '/test/rules/a/b', value: 'bye bob' },
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
            { username: 'alice', key: '/test/rules/d', ts: t_minus(now, 1), value: 'w' },
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
      
      it('should supply rows', testEnvironment(() => {
        rows.should.read({
          '/test/rules/*/*': [ { key: '/test/rules/b/d', value: null }, { key: '/test/rules/c/d', value: 'y' } ],
          '/test/rules/d': [ { key: '/test/rules/d', value: 'z' } ],
        });
      }));
      
      it('should supply outout', testEnvironment(() => {
        output.should.read({ username: 'alice', key: '/test/rules/a' });
      }));
      
      it('should supply #raw()', testEnvironment(() => async(cb => {
        rows['/test/rules/d'][0].raw((err, raw) => {
          raw.should.read([ { key: '/test/rules/d', value: 'w' }, { key: '/test/rules/d', value: 'z' } ]);
          cb(err);
        });
      })));
      
      it('should supply sum()', testEnvironment(() => {
        sum.should.be.a.Function();
        assert.equal(sum([ 1, 3, 5 ]), 9);
        assert.equal(sum([]), 0);
      }));
    });
  });
  
  describe('#destroy()', () => {
    
    beforeEach(done => {
      async.series([
        cb => omni.add('tester', 'alice', '/test/alpha', now, 80, cb),
        cb => omni.add('tester', 'bob', '/test/alpha', now, 100, cb),
        cb => omni.add('tester', 'bob', '/test/gamma', t_minus(now, 1), 70, cb),
        cb => omni.compute('/test', 'beta', [ 'alpha' ], alpha => alpha, cb),
      ], done);
    });
    
    it('should delete key', done => {
      async.series([
        cb => omni.destroy('tester', '/test/gamma', cb),
        cb => omni.get({ hidden: true }, cb),
      ], bail(done, results => {
        results.should.read([
          1,
          [ { key: '/test/alpha' }, { key: '/test/beta' }, { key: '/test/alpha' }, { key: '/test/beta' } ],
        ]);
        done();
      }));
    });
    
    it('should delete key + value', done => {
      async.series([
        cb => omni.get({ key: '/test/gamma', hidden: true }, cb),
        cb => omni.destroy('tester', '/test/gamma', cb),
        cb => omni.get({ key: '/test/gamma', hidden: true }, cb),
      ], bail(done, results => {
        results[0].should.read([ { key: '/test/gamma' }, { key: '/test/gamma' } ]);
        results[2].should.read([]);
        done();
      }));
    });
    
    it('should delete input', done => {
      async.series([
        cb => omni.active('/test/*', now, cb),
        cb => omni.get({ key: '/test/beta', hidden: true }, cb),
        cb => omni.destroy('tester', '/test/alpha', cb),
        cb => omni.get({ key: '/test/beta', hidden: true }, cb),
      ], bail(done, results => {
        results[1].should.read([ { value: 80 }, { value: 100 } ]);
        results[3].should.read([ { value: undefined }, { value: undefined } ]);
        done();
      }));
    });
    
    it('should delete wildcard input', done => {
      async.series([
        cb => omni.active('/test/*', now, cb),
        cb => omni.compute('/test', 'delta', [ 'alpha|beta|gamma' ], args => args.length, cb),
        cb => omni.get({ key: '/test/delta', hidden: true }, cb),
        cb => omni.destroy('tester', '/test/alpha', cb),
        cb => omni.get({ key: '/test/delta', hidden: true }, cb),
      ], bail(done, results => {
        results[2].should.read([ { value: 3 }, { value: 3 } ]);
        results[4].should.read([ { value: 2 }, { value: 2 } ]);
        done();
      }));
    });
    
    it('should not delete output', done => {
      async.series([
        cb => omni.destroy('tester', '/test/beta', cb),
      ], err => {
        should.exist(err);
        omni.get({ key: '/test/beta', hidden: true }, bail(done, rows => {
          rows.should.read([
            { username: 'alice', key: '/test/beta' }, { username: 'bob', key: '/test/beta' },
          ]);
          done();
        }));
      });
    });
    
    it('should require creator agent', done => {
      async.series([
        cb => omni.add('root', 'alice', '/extra/epsilon', now, 0, cb),
        cb => omni.destroy('tester', '/extra/epsilon', cb),
      ], err => {
        should.exist(err);
        omni.get({ key: '/extra/epsilon', hidden: true }, bail(done, rows => {
          rows.should.read([
            { username: 'alice', key: '/extra/epsilon', value: 0 }, { username: 'bob', key: '/extra/epsilon' },
          ]);
          done();
        }));
      });
    });
  });
  
  describe('#unsafeExecute()', () => {
    
    beforeEach(done => {
      omni.pg((client, done) => client.query(fixtures('small'), done), done);
    });
    
    it('should SELECT', done => {
      omni.unsafeExecute('root', 'SELECT username FROM users ORDER BY username', bail(done, (backend_pid, emitter) => {
        should.exist(backend_pid);
        async.parallel([
          cb => emitter.once('end', async.apply(cb, null)),
          cb => emitter.once('rows', async.apply(cb, null)),
        ], bail(done, results => {
          results.should.read([
            undefined,
            [
              {
                err: null,
                result: {
                  command: 'SELECT',
                  rowCount: 2,
                  fields: [ { name: 'username' } ],
                  rows: [ [ 'alice' ], [ 'bob' ] ],
                },
              },
            ],
          ]);
          done();
        }));
      }));
    });
    
    it('should require creator agent', done => {
      omni.unsafeExecute('tester', 'SELECT * FROM users', (err, backend_pid, emitter) => {
        should.exist(err);
        should.not.exist(backend_pid);
        should.not.exist(emitter);
        done();
      });
    });
  });
  
  describe('#unsafeCancelExecution()', () => {
    it('should cancel execution', done => {
      omni.unsafeExecute('root', 'SELECT pg_sleep(60)', bail(done, (backend_pid, emitter) => {
        should.exist(backend_pid);
        async.parallel([
          cb => emitter.once('end', async.apply(cb, null)),
          cb => emitter.once('rows', async.apply(cb, null)),
          cb => omni.unsafeCancelExecution('root', backend_pid, cb),
        ], bail(done, results => {
          results.should.read([
            undefined,
            [ { err: { message: /cancel/ }, result: undefined } ],
            {},
          ]);
          done();
        }));
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
    
    context('computation', () => {
      
      beforeEach(done => {
        async.series([
          cb => omni.active('/test/*', now, cb),
          cb => omni.compute('/test', 'y', [ 'x' ], x => `y=${x / 2}`, cb),
        ], done);
      });
      
      it('should precompute output', done => {
        async.series([
          cb => omni.get({ hidden: true }, cb),
          cb => omni.add('tester', 'alice', '/test/x', new Date(), 2, cb),
          cb => omni.cron(cb),
          cb => omni.add('tester', 'alice', '/test/z', new Date(), 'z', cb),
          cb => omni.get({ hidden: true }, cb),
        ], bail(done, results => {
          results[0].should.read([ { key: '/test/x', value: 0 }, { value: 'y=0' } ]);
          results[4].should.read([ { key: '/test/x', value: 2 }, { value: 'y=1' }, { value: 'z' } ]);
          (+results[4][1].created).should.be.lessThan(+results[4][2].created);
          done();
        }));
      });
    });
  });
});
