'use strict';

const net = require('net');

const request = require('request');
const should = require('should');
const sinon = require('sinon');

const serve_redirect = require('../src/serve-redirect');

describe('serve-redirect', function() {
  
  let server = serve_redirect.listen('https://example.com', 0);
  let req = request.defaults({
    baseUrl: 'http://localhost:' + server.address().port,
    followRedirect: false,
  });
  let clock;
  const delay = 1000 * 60;
  
  before(() => { clock = sinon.useFakeTimers() });
  
  after(done => server.close(done));
  after(() => clock.restore());
  
  it('GET / should redirect', done => {
    req.get('/', bail(done, (res, body) => {
      res.statusCode.should.eql(307);
      res.headers.location.should.eql('https://example.com/');
      body.should.eql('');
      done();
    }));
  });
  
  it('GET /:path should redirect', done => {
    req.get('/TEST.APP/ia00', bail(done, (res, body) => {
      res.statusCode.should.eql(307);
      res.headers.location.should.eql('https://example.com/TEST.APP/ia00');
      body.should.eql('');
      done();
    }));
  });
  
  it('GET /:path should continue redirecting', done => {
    req.get('/some/random/path', bail(done, (res, body) => {
      res.headers.location.should.eql('https://example.com/some/random/path');
      setTimeout(() => {
        server.listening.should.eql(true);
        done();
      }, 10);
      clock.tick(delay + 10);
    }));
  });
  
  it('GET /pause should pause redirecting', done => {
    let port = server.address().port;
    req.get('/pause', bail(done, (res, body) => {
      res.statusCode.should.eql(200);
      body.should.eql('');
      setTimeout(() => {
        server.listening.should.eql(false);
        let test = net.createServer().once('error', done).once('listening', () => {
          test.close(done);
          clock.tick(delay);
        }).listen(port);
      }, 10);
      clock.tick(10);
    }));
  });
  
  it('GET /pause should eventually resume redirecting', done => {
    req.get('/pause', bail(done, (res, body) => {
      setTimeout(() => {
        server.listening.should.eql(false);
      }, delay - 10);
      setTimeout(() => {
        server.listening.should.eql(true);
        req.get('/another/random/path', bail(done, () => done()));
      }, delay + 10);
      clock.tick(delay + 10);
    }));
  });
});
