'use strict';

const http = require('http');

const mit_api = require('../src/mit-api');

const client_id = 'test_client_id';
const client_secret = 'test_client_secret';

describe('MIT', function() {
  
  let cloudy = http.createServer();
  cloudy.expect = function(callback) {
    this.once('request', callback);
  };
  
  let mit;
  
  before(done => cloudy.listen(0, 'localhost', done));
  before(() => {
    mit = new mit_api.MIT_API({
      domain: 'localhost',
      connection: { protocol: 'http:', port: cloudy.address().port },
      client_id,
      client_secret,
    });
  });
  after(done => cloudy.close(done));
  
  describe('#person()', () => {
    
    it('should GET /people/v3/people/:kerberosId', done => {
      cloudy.expect((req, res) => {
        req.method.should.eql('GET');
        req.headers.should.read({
          host: /mit-people-v3\.localhost/,
          client_id,
          client_secret
        });
        req.url.should.eql('/people/v3/people/benbit');
        res.end(JSON.stringify({}));
      });
      
      mit.person('benbit', (err) => {
        done(err);
      });
    });
    
    it('should return expected properties', done => {
      let expected = { givenName: 'Ben', familyName: 'Bitdiddle', displayName: 'Ben Bitdiddle' };
      
      cloudy.expect((req, res) => {
        res.end(JSON.stringify({ item: expected }));
      });
      
      mit.person('benbit', (err, userinfo) => {
        userinfo.should.read(expected);
        done(err);
      });
    });
    
    it('should return only expected properties', done => {
      let expected = { givenName: 'Ben' };
      
      cloudy.expect((req, res) => {
        res.end(JSON.stringify({ item: { givenName: 'Ben', secretName: 'Secret' } }));
      });
      
      mit.person('benbit', (err, userinfo) => {
        userinfo.should.read(expected);
        done(err);
      });
    });
    
    it('should make requests in series', done => {
      cloudy.expect((req, res) => {
        req.url.should.endWith('alice');
        setTimeout(() => {
          cloudy.expect((req, res) => {
            req.url.should.endWith('bob');
            res.end(JSON.stringify({ item: { givenName: 'Bob' } }));
          });
          res.end(JSON.stringify({ item: { givenName: 'Alice' } }));
        }, 10);
      });
      
      let alice = false;
      mit.person('alice', (err, userinfo) => {
        if (err) { return done(err); }
        alice.should.be.false();
        userinfo.should.read({ givenName: 'Alice' });
        alice = true;
      });
      mit.person('bob', (err, userinfo) => {
        if (err) { return done(err); }
        alice.should.be.true();
        userinfo.should.read({ givenName: 'Bob' });
        done();
      });
    });
  });
});
