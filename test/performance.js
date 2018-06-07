'use strict';

const async = require('async');

const omnivore = require('../src/omnivore');

describe('Omnivore', function() {
  
  let omni = new omnivore.Omnivore('TEST.PERFORMANCE/ia00');
  let now = new Date();
  
  let ready = new Promise(resolve => omni.once('ready', () => {
    omni.pg((client, done) => {
      console.log('performance fixtures!');
      async.series([
        cb => client.query(fixtures('destroy'), cb),
        cb => client.query(fixtures('base'), cb),
        cb => client.query(fixtures('large'), cb),
      ], done);
    }, resolve);
  }));
  
  before(function(done) {
    this.timeout(10000);
    ready.then(done);
  });
  
  describe('performance', () => {
    it('#get()', done => {
      omni.get({ username: 'user1', key: '/test/zero-fraction' }, function(err, rows) {
        rows[0].value[0].should.be.aboveOrEqual(0).and.below(rows[0].value[1]);
        done(err);
      });
    });
  });
});
