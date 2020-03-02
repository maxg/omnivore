'use strict';

const http = require('http');

const async = require('async');
const sinon = require('sinon');
const slack = require('@slack/client');

const config = require('../config');
const notifier = require('../src/notifier');
const omnivore = require('../src/omnivore');

const slack_path = '/A/B/C';
const slack_channel = '#nom';
const missing_config = 'missing slack config';

describe('Notifier', function() {
  
  let sandbox = sinon.sandbox.create();
  let slacker = http.createServer();
  slacker.expect = function(callback) {
    this.once('request', (req, res) => {
      let data = [];
      req.on('data', d => data.push(d));
      req.on('end', () => {
        req.body = JSON.parse(Buffer.concat(data).toString());
        res.end();
        callback(req);
      });
    });
  };
  
  let course = 'TEST.NOTIFY/ia00';
  let omni = new omnivore.Omnivore(course, config, true);
  let notify = new notifier.Notifier('http://localhost', omni);
  
  let ready = new Promise(resolve => omni.once('ready', resolve));
  before(done => { ready.then(done) });
  after(done => omni.close(done));
  
  before(done => slacker.listen(0, 'localhost', done));
  after(done => slacker.close(done));
  
  beforeEach(function(done) {
    omni.memo.agent.clear();
    omni.pg((client, done) => {
      async.series([
        cb => client.query(fixtures('destroy'), cb),
        cb => client.query(fixtures('base'), cb),
        cb => {
          if (this.currentTest.title.endsWith(missing_config)) { return cb(); }
          let config = {
            url: `http://localhost:${slacker.address().port}${slack_path}`,
            channel: slack_channel,
          };
          client.query(`INSERT INTO agents VALUES ('slackbot', '${JSON.stringify(config)}', '{}', '{}');`, cb);
        },
      ], done);
    }, done);
  });
  
  afterEach(() => sandbox.restore());
  
  describe('#added()', () => {
    
    it('should POST to Slack', done => {
      slacker.expect(req => {
        req.method.should.eql('POST');
        req.url.should.eql('/A/B/C');
        req.body.should.read({
          username: 'omnivore',
          channel: slack_channel,
          text: /grade/,
        });
        done();
      });
      notify.added('alyssa', []);
    });
    
    it('should link to upload preview', done => {
      slacker.expect(req => {
        req.body.should.read({ text: /<http:\/\/localhost\/up\/123|.*>/ });
        done();
      });
      notify.added('alyssa', [], { path: '/up/123' });
    });
    
    it(`should ignore ${missing_config}`, done => {
      sandbox.stub(slack, 'IncomingWebhook').throws();
      notify.added('alyssa', []);
      setTimeout(done, 1);
    });
  });
  
  describe('#error()', () => {
    
    it('should POST to Slack', done => {
      slacker.expect(req => {
        req.method.should.eql('POST');
        req.url.should.eql('/A/B/C');
        req.body.should.read({
          username: 'omnivore',
          channel: slack_channel,
          attachments: [ { color: 'danger', text: /Error: \{whoops\}/ } ],
        });
        done();
      });
      notify.error(new Error('{whoops}'));
    });
    
    it('should include request details', done => {
      slacker.expect(req => {
        req.body.should.read({ attachments: [ { text: /GET \/ .* user alyssa/ } ] });
        done();
      });
      notify.error(new Error(), {
        method: 'GET', url: '/'
      }, {
        locals: { authuser: 'alyssa' },
      });
    });
    
    it('should ignore missing error', done => {
      slacker.expect(req => {
        req.body.should.read({ attachments: [ { text: /Unknown error/ } ] });
        done();
      });
      notify.error(null);
    });
    
    it('should ignore invalid inputs', done => {
      slacker.expect(req => {
        req.body.should.read({ attachments: [ { text: /Unknown error/ } ] });
        done();
      });
      notify.error('err', 'req', 'res');
    });
    
    it(`should ignore ${missing_config}`, done => {
      sandbox.stub(slack, 'IncomingWebhook').throws();
      notify.error(new Error());
      setTimeout(done, 1);
    });
  });
});
