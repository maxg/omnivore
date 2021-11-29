'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');

const async = require('async');
const csv = require('csv');
const request = require('request');
const should = require('should');
const sinon = require('sinon');

const config = require('../config');
const omnivore = require('../src/omnivore');
const serve_course = require('../src/serve-course');

const x_auth_user = 'X-Authenticated-User';
const x_omni_sign = 'X-Omnivore-Signed';

describe('serve-course', function() {
  
  let sandbox = sinon.sandbox.create();
  
  let course = 'TEST.APP/ia00';
  let omni = new omnivore.Omnivore(course, config, true);
  let app = serve_course.createApp('http://localhost', omni);
  let server = http.createServer(app);
  let req;
  let now = new Date();
  
  let ready = new Promise(resolve => omni.once('ready', resolve));
  before(done => { ready.then(done) });
  after(done => omni.close(done));
  
  before(done => server.listen(0, 'localhost', done));
  before(done => {
    req = request.defaults({
      baseUrl: 'http://localhost:' + server.address().port,
      followRedirect: false,
    });
    req.headers = headers => req.defaults({ headers });
    req.get('/', done);
  });
  
  after(done => server.close(done));
  
  before(done => {
    omni.pg((client, done) => {
      async.series([
        cb => client.query(fixtures('base'), cb),
        cb => client.query(fixtures('small'), cb),
      ], done);
    }, done);
  });
  beforeEach(done => {
    omni.pg((client, done) => {
      async.series([
        cb => client.query(fixtures('destroy'), cb),
        cb => client.query(fixtures('create'), cb),
        cb => client.query(fixtures('base'), cb),
        cb => client.query(fixtures('small'), cb),
      ], done);
    }, done);
  });
  
  beforeEach(() => {
    sandbox.spy(app, 'render');
    app.render.templates = () => app.render.args.map(call => call[0]);
  });
  afterEach(() => sandbox.restore());
  
  describe('POST /api/v2/multiadd', () => {
    
    let url = '/api/v2/multiadd';
    let username = 'alice';
    let key = '/test/alpha';
    let input = [ { username, key, ts: now, value: 100 } ];
    let sign = crypto.createSign('RSA-SHA256');
    sign.update(JSON.stringify(input));
    let signature = sign.sign(fs.readFileSync('test/fixtures/key-private.pem'), 'base64');
    
    it('should add data', done => {
      req.headers({ [x_omni_sign]: 'tester ' + signature }).post(url, { json: input }, bail(done, res => {
        res.statusCode.should.eql(200);
        omni.get({ username, key, hidden: true }, bail(done, rows => {
          rows.should.read(input);
          done();
        }));
      }));
    });
    
    it('should reject invalid signature', done => {
      req.headers({ [x_omni_sign]: 'tester x' + signature }).post(url, { json: input }, bail(done, res => {
        res.statusCode.should.eql(403);
        omni.get({ username, key, hidden: true }, bail(done, rows => {
          rows.should.read([]);
          done();
        }));
      }));
    });
  });
  
  describe('GET /', () => {
    
    let url ='/';
    
    it('should require authenticated user header', done => {
      req.get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(500);
        app.render.templates().should.eql([ '500' ]);
        done();
      }));
    });
    
    it('should temporarily redirect to user for students', done => {
      req.headers({ [x_auth_user]: 'alice' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(302);
        app.render.templates().should.eql([]);
        res.headers.location.should.eql(`/${course}/u/alice/`);
        done();
      }));
    });
    
    it('should render index for staff', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(url, bail(done, (res, body) => {
        app.render.templates().should.eql([ 'course' ]);
        body.should.match(/My grades/);
        body.should.match(/All grades/);
        body.should.match(/Upload grades/);
        done();
      }));
    });
  });
  
  describe('GET /u/:username/', () => {
    
    let url = '/u/bob/';
    
    it('should reject unauthorized user', done => {
      req.headers({ [x_auth_user]: 'alice' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ '401' ]);
        body.should.not.match(/bob/);
        body.should.match(/permission denied/);
        done();
      }));
    });
    
    it('should render user root for student', done => {
      req.headers({ [x_auth_user]: 'bob' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ 'user-dir' ]);
        body.should.match(/bob/);
        done();
      }));
    });
    
    it('should render user root for staff', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ 'user-dir' ]);
        body.should.match(/bob/);
        done();
      }));
    });
    
    it('w/o / should redirect to user', done => {
      req.headers({ [x_auth_user]: 'bob' }).get(url.split(/\/$/)[0], bail(done, (res, body) => {
        res.statusCode.should.eql(301);
        app.render.templates().should.eql([]);
        res.headers.location.should.eql(`/${course}${url}`);
        done();
      }));
    });
  });
  
  describe('GET /u/:username/:internal-key', () => {
    
    let url = '/u/bob/test/class-1';
    
    it('should reject unauthorized user', done => {
      req.headers({ [x_auth_user]: 'alice' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ '401' ]);
        body.should.not.match(/bob/);
        body.should.match(/permission denied/);
        done();
      }));
    });
    
    it('should render internal key for student', done => {
      req.headers({ [x_auth_user]: 'bob' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ 'user-dir' ]);
        body.should.match(/bob/);
        body.should.match(/nanoquiz.*9/);
        done();
      }));
    });
    
    it('should render internal key for staff', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ 'user-dir' ]);
        done();
      }));
    });
    
    it('w/ / should redirect to internal key', done => {
      req.headers({ [x_auth_user]: 'bob' }).get(`${url}/`, bail(done, (res, body) => {
        res.statusCode.should.eql(301);
        app.render.templates().should.eql([]);
        res.headers.location.should.eql(`/${course}${url}`);
        done();
      }));
    });
  });
  
  describe('GET /u/:username/:leaf-key', () => {
    
    let url = '/u/bob/test/class-1/nanoquiz';
    
    it('should reject unauthorized user', done => {
      req.headers({ [x_auth_user]: 'alice' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ '401' ]);
        body.should.not.match(/bob/);
        body.should.match(/permission denied/);
        done();
      }));
    });
    
    it('should render leaf key for student', done => {
      req.headers({ [x_auth_user]: 'bob' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ 'user-grade' ]);
        body.should.match(/bob/);
        body.should.match(/nanoquiz.*9/);
        done();
      }));
    });
    
    it('should render leaf key for staff', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ 'user-grade' ]);
        done();
      }));
    });
    
    it('w/ / should redirect to leaf key', done => {
      req.headers({ [x_auth_user]: 'bob' }).get(`${url}/`, bail(done, (res, body) => {
        res.statusCode.should.eql(301);
        app.render.templates().should.eql([]);
        res.headers.location.should.eql(`/${course}${url}`);
        done();
      }));
    });
  });
  
  describe('GET /u/:username/:internal-key.history', () => {
    
    let url = '/u/bob/test/class-1.history';
    
    it('should reject unauthorized user', done => {
      req.headers({ [x_auth_user]: 'alice' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ '401' ]);
        body.should.not.match(/bob/);
        body.should.match(/permission denied/);
        done();
      }));
    });
    
    it('should fail', done => {
      req.headers({ [x_auth_user]: 'bob' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(404);
        app.render.templates().should.eql([ '404' ]);
        done();
      }));
    });
  });
  
  describe('GET /u/:username/:leaf-key.history', () => {
    
    let url = '/u/bob/test/class-1/nanoquiz.history';
    
    it('should reject unauthorized user', done => {
      req.headers({ [x_auth_user]: 'alice' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ '401' ]);
        body.should.not.match(/bob/);
        body.should.match(/permission denied/);
        done();
      }));
    });
    
    it('should render leaf key history for student', done => {
      req.headers({ [x_auth_user]: 'bob' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ 'user-grade' ]);
        body.should.match(/bob/);
        body.should.match(/nanoquiz.*9/);
        done();
      }));
    });
    
    it('should render leaf key history for staff', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ 'user-grade' ]);
        done();
      }));
    });
  });
  
  describe('GET /user/', () => {
    
    let url = '/user/';
    
    it('should redirect to user', done => {
      req.headers({ [x_auth_user]: 'bob' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(301);
        app.render.templates().should.eql([]);
        res.headers.location.should.eql(`/${course}/u/bob/`);
        done();
      }));
    });
    
    it('w/o / should redirect to user', done => {
      req.headers({ [x_auth_user]: 'bob' }).get(url.split(/\/$/)[0], bail(done, (res, body) => {
        res.statusCode.should.eql(301);
        app.render.templates().should.eql([]);
        res.headers.location.should.eql(`/${course}${url}`);
        done();
      }));
    });
    
  });
  
  describe('GET /user/:key', () => {
    
    let url = '/user/test/class-2';
    
    it('should redirect to user key', done => {
      req.headers({ [x_auth_user]: 'bob' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(301);
        app.render.templates().should.eql([]);
        res.headers.location.should.eql(`/${course}/u/bob/test/class-2`);
        done();
      }));
    });
    
    it('w/ / should redirect to user key', done => {
      req.headers({ [x_auth_user]: 'bob' }).get(`${url}/`, bail(done, (res, body) => {
        res.statusCode.should.eql(301);
        app.render.templates().should.eql([]);
        res.headers.location.should.eql(`/${course}/u/bob/test/class-2/`);
        done();
      }));
    });
  });
  
  describe('GET /grades/', () => {
    
    let url = '/grades/';
    
    it('should require staff', done => {
      req.headers({ [x_auth_user]: 'alice' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ '401' ]);
        body.should.match(/permission denied/);
        done();
      }));
    });
    
    it('should render grades root', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ 'staff-dir' ]);
        body.should.match(/bullet.*<a.*test.*test/);
        done();
      }));
    });
    
    it('w/o / should redirect to grades root', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(url.split(/\/$/)[0], bail(done, (res, body) => {
        res.statusCode.should.eql(301);
        app.render.templates().should.eql([]);
        res.headers.location.should.eql(`/${course}${url}`);
        done();
      }));
    });
  });
  
  describe('GET /grades/:internal-key', () => {
    
    let url = '/grades/test/class-1';
    
    it('should require staff', done => {
      req.headers({ [x_auth_user]: 'alice' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ '401' ]);
        body.should.match(/permission denied/);
        done();
      }));
    });
    
    it('should render internal key', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ 'staff-dir' ]);
        body.should.match(/test.*class-1.*bullet.*<a.*nanoquiz.*nanoquiz/);
        done();
      }));
    });
    
    it('w/ / should redirect to internal key', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(`${url}/`, bail(done, (res, body) => {
        res.statusCode.should.eql(301);
        app.render.templates().should.eql([]);
        res.headers.location.should.eql(`/${course}${url}`);
        done();
      }));
    });
  });
  
  describe('GET /grades/:leaf-key', () => {
    
    let url = '/grades/test/class-1/nanoquiz';
    
    it('should require staff', done => {
      req.headers({ [x_auth_user]: 'alice' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ '401' ]);
        body.should.match(/permission denied/);
        done();
      }));
    });
    
    it('should render current leaf key', done => {
      omni.get({ key: '/test/class-1/nanoquiz' }, bail(done, () => {
        req.headers({ [x_auth_user]: 'staffer' }).get(url, bail(done, (res, body) => {
          res.statusCode.should.eql(200);
          app.render.templates().should.eql([ 'staff-grades' ]);
          body.should.match(/test.*class-1.*nanoquiz.*alice.*10.*bob.*9/);
          body.should.match(/<td[^>]*visible[^>]*data-on/);
          body.should.match(/agent.*nanoquizzer/);
          body.should.not.match(/data-stream/);
          done();
        }));
      }));
    });
    
    it('should stream non-current leaf key', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ 'staff-grades' ]);
        body.should.match(/test.*class-1.*nanoquiz.*data-stream-user="alice".*alice.*none.*data-stream-user="bob".*bob.*none/);
        let [ stream_course, stream_path ] = /<table[^>]*data-stream="\/([^"]+)(\/stream\/[^"]+)"/.exec(body).slice(1);
        stream_course.should.eql(course);
        req.headers({ [x_auth_user]: 'staffer' }).get(stream_path, bail(done, (stream_res, stream_body) => {
          stream_res.statusCode.should.eql(200);
          stream_body.should.match(/data-stream-user="alice".*alice.*10/);
          stream_body.should.match(/data-stream-user="bob".*bob.*9/);
          done();
        }));
      }));
    });
    
    it('w/ / should redirect to leaf key', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(`${url}/`, bail(done, (res, body) => {
        res.statusCode.should.eql(301);
        app.render.templates().should.eql([]);
        res.headers.location.should.eql(`/${course}${url}`);
        done();
      }));
    });
  });
  
  describe('GET /grades/:key.destroy', done => {
    
    let url = '/grades/test/class-1/nanoquiz.destroy';
    
    it('should require staff', done => {
      req.headers({ [x_auth_user]: 'alice' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ '401' ]);
        body.should.match(/permission denied/);
        done();
      }));
    });
    
    it('should link to CSV', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ 'staff-destroy' ]);
        body.should.match(/grades\/test\/class-1\/nanoquiz\.csv/);
        done();
      }));
    });
  });
  
  describe('POST /grades/:key.destroy', () => {
    
    let url = '/grades/test/class-2/nanoquiz.destroy';
    
    it('should require staff', done => {
      req.headers({ [x_auth_user]: 'alice' }).post(url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ '401' ]);
        body.should.match(/permission denied/);
        done();
      }));
    });
    
    it('should require agent', done => {
      req.headers({ [x_auth_user]: 'staffer' }).post(url, bail(done, (res, body) => {
        res.statusCode.should.eql(500);
        app.render.templates().should.eql([ '500' ]);
        omni.get({ key: '/test/class-2/nanoquiz', hidden: true }, bail(done, result => {
          result.should.read([ { username: 'alice', value: 8 }, { username: 'bob', value: null } ]);
          done();
        }));
      }));
    });
    
    it('should redirect to key', done => {
      req.headers({ [x_auth_user]: 'nanoquizzer' }).post(url, bail(done, res => {
        res.statusCode.should.eql(303);
        app.render.templates().should.eql([]);
        res.headers.location.should.eql(`/${course}/grades/test/class-2/nanoquiz`);
        done();
      }));
    });
    
    it('should delete key', done => {
      req.headers({ [x_auth_user]: 'nanoquizzer' }).post(url, bail(done, (res, body) => {
        omni.keys([ '/test/class-2/nanoquiz' ], bail(done, result => {
          result.should.read([ { key: '/test/class-2/nanoquiz', exists: false } ]);
          done();
        }));
      }));
    });
  });
  
  describe('GET /grades/:keys.csv', () => {
    
    let single_url = '/grades/test/class-1/nanoquiz.csv';
    let multi_url = '/grades/test/class-2/nanoquiz,/test/class-1/nanoquiz.csv';
    
    it('should require staff', done => {
      req.headers({ [x_auth_user]: 'alice' }).get(single_url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ '401' ]);
        body.should.match(/permission denied/);
        done();
      }));
    });
    
    it('should render single-key CSV', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(single_url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        let date = omnivore.types.dateTimeString(new Date());
        csv.parse(body, { relax_column_count: true }, (err, sheet) => {
          sheet.should.read([
            [ 'username', '/test/class-1/nanoquiz', `exported ${date} by staffer` ],
            [ 'alice', '10' ],
            [ 'bob', '9' ],
          ]);
          done(err);
        });
      }));
    });
    
    it('should render multi-key CSV', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(multi_url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        let date = omnivore.types.dateTimeString(new Date());
        csv.parse(body, { relax_column_count: true }, (err, sheet) => {
          sheet.should.read([
            [ 'username', '/test/class-2/nanoquiz', '/test/class-1/nanoquiz', `exported ${date} by staffer` ],
            [ 'alice', '8', '10' ],
            [ 'bob', '', '9' ],
          ]);
          done(err);
        });
      }));
    });
    
    it('should restrict to roster', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(multi_url + '?roster=1', bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        csv.parse(body, { relax_column_count: true }, (err, sheet) => {
          sheet.should.read([
            [ 'username', '/test/class-2/nanoquiz', '/test/class-1/nanoquiz', /exported/ ],
            [ 'alice', '8', '10' ],
          ]);
          done(err);
        });
      }));
    });
  });
  
  describe('GET /grades/:queries.csv', () => {
    
    let single = '/grades/*/*/nanoquiz.csv';
    let multiple = '/grades/*/class-2/*,/*/class-1/nanoquiz.csv';
    let expanded = '/grades/test/class-1/nanoquiz,/test/class-2/nanoquiz.csv';
    
    it('should require staff', done => {
      req.headers({ [x_auth_user]: 'alice' }).get(single, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ '401' ]);
        body.should.match(/permission denied/);
        done();
      }));
    });
    
    it('should render single-query CSV', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(single, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        let date = omnivore.types.dateTimeString(new Date());
        csv.parse(body, { relax_column_count: true }, (err, sheet) => {
          sheet.should.read([
            [ 'username', '/test/class-1/nanoquiz', '/test/class-2/nanoquiz', `exported ${date} by staffer` ],
            [ 'alice', '10', '8' ],
            [ 'bob', '9', '' ],
          ]);
          done(err);
        });
      }));
    });
    
    it('should render multi-query CSV', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(multiple, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        let date = omnivore.types.dateTimeString(new Date());
        csv.parse(body, { relax_column_count: true }, (err, sheet) => {
          sheet.should.read([
            [ 'username', '/test/class-1/nanoquiz', '/test/class-2/nanoquiz', `exported ${date} by staffer` ],
            [ 'alice', '10', '8' ],
            [ 'bob', '9', '' ],
          ]);
          done(err);
        });
      }));
    });
    
    it('should restrict to roster', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(single + '?roster=1', bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        let date = omnivore.types.dateTimeString(new Date());
        csv.parse(body, { relax_column_count: true }, (err, sheet) => {
          sheet.should.read([
            [ 'username', '/test/class-1/nanoquiz', '/test/class-2/nanoquiz', /exported/ ],
            [ 'alice', '10', '8' ],
          ]);
          done(err);
        });
      }));
    });
  });
  
  describe('GET /grades/:query', () => {
    
    let url = '/grades/test/*/nanoquiz';
    
    it('should require staff', done => {
      req.headers({ [x_auth_user]: 'alice' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ '401' ]);
        body.should.match(/permission denied/);
        done();
      }));
    });
    
    it('should render query', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ 'staff-keys' ]);
        body.should.match(/<a.*test.*class-1.*nanoquiz.*test.*class-1.*nanoquiz.*<a.*test.*class-2.*nanoquiz.*test.*class-2.*nanoquiz/);
        done();
      }));
    });
    
    it('w/ / should redirect to query', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(`${url}/`, bail(done, (res, body) => {
        res.statusCode.should.eql(301);
        app.render.templates().should.eql([]);
        res.headers.location.should.eql(`/${course}${url}`);
        done();
      }));
    });
  });
  
  describe('POST /u/:username/:key.history', () => {
    
    it('should require staff');
    
    it('should redirect to preview');
  });
  
  describe('POST /upload.csv', () => {
    
    let url = '/upload.csv';
    let formData = { grades: { value: 'username\n', options: { filename: 'upload.csv' } } };
    
    it('should require staff', done => {
      req.headers({ [x_auth_user]: 'alice' }).post(url, { formData }, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ '401' ]);
        body.should.match(/permission denied/);
        done();
      }));
    });
    
    it('should redirect to preview', done => {
      req.headers({ [x_auth_user]: 'staffer' }).post(url, { formData }, bail(done, res => {
        res.statusCode.should.eql(303);
        app.render.templates().should.eql([]);
        res.headers.location.should.startWith(`/${course}/upload/`);
        done();
      }));
    });
  });
  
  describe('GET /upload/:upload_id', () => {
    
    let upload_url = '/upload.csv';
    let formData = { grades: { value: 'username,/foo\nalice,12.3\n', options: { filename: 'upload.csv' } } };
    let save_url;
    
    before(done => {
      req.headers({ [x_auth_user]: 'staffer' }).post(upload_url, { formData }, (err, res) => {
        save_url = res.headers.location.replace(`/${course}`, '');
        save_url.should.startWith('/upload/');
        done(err);
      });
    });
    
    it('should require staff', done => {
      req.headers({ [x_auth_user]: 'alice' }).get(save_url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ '401' ]);
        body.should.match(/permission denied/);
        done();
      }));
    });
    
    it('should render data', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(save_url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ 'upload-preview' ]);
        body.should.match(/created.*by staffer.*expires/);
        body.should.match(/\/foo/);
        body.should.match(/alice.*12\.3/);
        done();
      }));
    });
    
    it('should link to CSV', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(save_url, bail(done, (res, body) => {
        body.should.containEql(save_url + '.csv');
        done();
      }));
    });
    
    it('should fail with missing upload', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(save_url.replace(/.{8}$/, '00000000'), bail(done, res => {
        res.statusCode.should.eql(404);
        app.render.templates().should.eql([ '404' ]);
        done();
      }));
    });
  });
  
  describe('GET /upload/:upload_id.csv', () => {
    
    let upload_url = '/upload.csv';
    let formData = { grades: { value: 'username,/foo\nalice,12.3\n', options: { filename: 'upload.csv' } } };
    let csv_url;
    
    before(done => {
      req.headers({ [x_auth_user]: 'staffer' }).post(upload_url, { formData }, (err, res) => {
        csv_url = res.headers.location.replace(`/${course}`, '') + '.csv';
        csv_url.should.startWith('/upload/');
        done(err);
      });
    });
    
    it('should require staff', done => {
      req.headers({ [x_auth_user]: 'alice' }).get(csv_url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ '401' ]);
        body.should.match(/permission denied/);
        done();
      }));
    });
    
    it('should render CSV', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(csv_url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        let date = omnivore.types.dateTimeString(new Date());
        csv.parse(body, { relax_column_count: true }, (err, sheet) => {
          sheet.should.read([
            [ 'username', '/foo', '', `created ${date} by staffer` ],
            [ 'alice', '12.3' ],
          ]);
          done(err);
        });
      }));
    });
  });
  
  describe('POST /upload/:upload_id', () => {
    
    let upload_url = '/upload.csv';
    let formData = { grades: {
      value: 'username,/test/class-2/nanoquiz,/test/class-3/nanoquiz\nalice,7,0\nbob,6',
      options: { filename: 'upload.csv' },
    } };
    let save_url;
    
    before(done => {
      req.headers({ [x_auth_user]: 'staffer' }).post(upload_url, { formData }, (err, res) => {
        save_url = res.headers.location.replace(`/${course}`, '');
        save_url.should.startWith('/upload/');
        done(err);
      });
    });
    
    it('should require staff', done => {
      req.headers({ [x_auth_user]: 'alice' }).post(save_url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ '401' ]);
        body.should.match(/permission denied/);
        done();
      }));
    });
    
    it('should require agent', done => {
      req.headers({ [x_auth_user]: 'staffer' }).post(save_url, bail(done, (res, body) => {
        res.statusCode.should.eql(500);
        app.render.templates().should.eql([ '500' ]);
        omni.multiget([ '/test/class-2/nanoquiz', '/test/class-3/nanoquiz' ], { hidden: true }, bail(done, rows => {
          rows.should.read([
            { username: 'alice', '/test/class-2/nanoquiz': { value: 8 }, '/test/class-3/nanoquiz': undefined },
            { username: 'bob', '/test/class-2/nanoquiz': { value: null }, '/test/class-3/nanoquiz': undefined },
          ]);
          done();
        }));
      }));
    });
    
    it('should render summary', done => {
      req.headers({ [x_auth_user]: 'nanoquizzer' }).post(save_url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ 'upload-saved' ]);
        body.should.match(/Saved 3 grades/);
        body.should.match(/skipped 1 invalid/);
        body.should.match(/dated.*by nanoquizzer/);
        body.should.match(/\/test\/class-2\/nanoquiz/);
        body.should.match(/\/test\/class-3\/nanoquiz/);
        done();
      }));
    });
    
    it('should save data', done => {
      req.headers({ [x_auth_user]: 'nanoquizzer' }).post(save_url, bail(done, (res, body) => {
        omni.multiget([ '/test/class-2/nanoquiz', '/test/class-3/nanoquiz' ], { hidden: true }, bail(done, rows => {
          rows.should.read([
            { username: 'alice', '/test/class-2/nanoquiz': { value: 7 }, '/test/class-3/nanoquiz': { value: 0 } },
            { username: 'bob', '/test/class-2/nanoquiz': { value: 6 }, '/test/class-3/nanoquiz': { value: null } },
          ]);
          done();
        }));
      }));
    });
    
    it('should use timestamp');
    
    it('should record save time', done => {
      req.headers({ [x_auth_user]: 'nanoquizzer' }).post(save_url, bail(done, () => {
        req.headers({ [x_auth_user]: 'staffer' }).get(save_url, bail(done, (res, body) => {
          res.statusCode.should.eql(200);
          body.should.match(/saved/);
          done();
        }));
      }));
    });
    
    it('should fail with missing upload', done => {
      req.headers({ [x_auth_user]: 'staffer' }).post(save_url.replace(/.{8}$/, '00000000'), bail(done, res => {
        res.statusCode.should.eql(404);
        app.render.templates().should.eql([ '404' ]);
        done();
      }));
    });
  });
  
  describe('GET /users/', () => {
    
    let url = '/users/';
    
    it('should require staff', done => {
      req.headers({ [x_auth_user]: 'alice' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ '401' ]);
        body.should.match(/permission denied/);
        done();
      }));
    });
    
    it('should render users', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(url, bail(done, (res, body) => {
        res.statusCode.should.eql(200);
        app.render.templates().should.eql([ 'staff-users' ]);
        body.should.match(/alice/);
        body.should.match(/bob/);
        let stream_path = /\/stream\/[^"]+/.exec(body)[0];
        req.headers({ [x_auth_user]: 'staffer' }).get(stream_path, bail(done, (stream_res, stream_body) => {
          stream_res.statusCode.should.eql(200);
          stream_body.should.match(/data-stream-user="alice".*alice/);
          stream_body.should.match(/data-stream-user="bob".*bob/);
          done();
        }));
      }));
    });
    
    it('w/o / should redirect to users', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(url.split(/\/$/)[0], bail(done, (res, body) => {
        res.statusCode.should.eql(301);
        app.render.templates().should.eql([]);
        res.headers.location.should.eql(`/${course}${url}`);
        done();
      }));
    });
  });
});
