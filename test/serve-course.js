'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');

const async = require('async');
const csv = require('csv');
const request = require('request');
const should = require('should');
const sinon = require('sinon');

const omnivore = require('../src/omnivore');
const serve_course = require('../src/serve-course');

const x_auth_user = 'X-Authenticated-User';
const x_omni_sign = 'X-Omnivore-Signed';

describe('serve-course', function() {
  
  let sandbox = sinon.sandbox.create();
  
  let course = 'TEST.APP/ia00';
  let omni = new omnivore.Omnivore(course);
  let app = serve_course.createApp(omni);
  let server = http.createServer(app);
  let req;
  let now = new Date();
  
  let ready = new Promise(resolve => omni.once('ready', resolve));
  before(done => { ready.then(done) });
  
  before(done => server.listen(0, 'localhost', done));
  before(() => {
    req = request.defaults({
      baseUrl: 'http://localhost:' + server.address().port,
      followRedirect: false,
    });
    req.headers = headers => req.defaults({ headers });
  });
  
  after(done => server.close(done));
  
  beforeEach(done => {
    omni.pg((client, done) => {
      async.series([
        cb => client.query(fixtures('destroy'), cb),
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
    
    it('should render index for students', done => {
      req.headers({ [x_auth_user]: 'alice' }).get(url, bail(done, (res, body) => {
        app.render.templates().should.eql([ 'course' ]);
        body.should.match(/My grades/);
        body.should.not.match(/All grades/);
        body.should.not.match(/Upload grades/);
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
    
    it('should redirect to user key');
    
    it('w/ / should redirect to user key');
  });
  
  describe('GET /grades', () => {
    
    it('should require staff');
    
    it('should render grades root');
  });
  
  describe('GET /grades/:internal-key', () => {
    
    it('should require staff');
    
    it('should render internal key');
    
    it('w/ / should redirect to internal key');
  });
  
  describe('GET /grades/:leaf-key', () => {
    
    it('should require staff');
    
    it('should render leaf key');
    
    it('w/ / should redirect to leaf key');
  });
  
  describe('GET /grades/:keys.csv', () => {
    
    let single_url = '/grades/test/class-1/nanoquiz.csv';
    let multi_url = '/grades/test/class-1/nanoquiz,/test/class-2/nanoquiz.csv';
    
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
            [ 'username', '/test/class-1/nanoquiz', '/test/class-2/nanoquiz', `exported ${date} by staffer` ],
            [ 'alice', '10', '8' ],
            [ 'bob', '9', '' ],
          ]);
          done(err);
        });
      }));
    });    
  });
  
  describe('POST /grades.csv', () => {
    
    let url = '/grades.csv';
    let formData = { csv: { value: 'username\n', options: { filename: 'upload.csv' } } };
    
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
        res.headers.location.should.startWith(`/${course}${url}/`);
        done();
      }));
    });
  });
  
  describe('GET /grades.csv/:upload_id', () => {
    
    let upload_url = '/grades.csv';
    let formData = { csv: { value: 'username,/foo\nalice,12.3\n', options: { filename: 'upload.csv' } } };
    let save_url;
    
    before(done => {
      req.headers({ [x_auth_user]: 'staffer' }).post(upload_url, { formData }, (err, res) => {
        save_url = res.headers.location.replace(`/${course}`, '');
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
    
    it('should fail with missing upload', done => {
      req.headers({ [x_auth_user]: 'staffer' }).get(save_url.replace(/.{8}$/, '00000000'), bail(done, res => {
        res.statusCode.should.eql(404);
        app.render.templates().should.eql([ '404' ]);
        done();
      }));
    });
  });
  
  describe('POST /grades.csv/:upload_id', () => {
    
    let upload_url = '/grades.csv';
    let formData = { csv: {
      value: 'username,/test/class-2/nanoquiz,/test/class-3/nanoquiz\nalice,7,0\nbob,6,5',
      options: { filename: 'upload.csv' },
    } };
    let save_url;
    
    before(done => {
      req.headers({ [x_auth_user]: 'staffer' }).post(upload_url, { formData }, (err, res) => {
        save_url = res.headers.location.replace(`/${course}`, '');
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
        body.should.match(/Saved 2 keys.*2 users.*4 grades/);
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
            { username: 'bob', '/test/class-2/nanoquiz': { value: 6 }, '/test/class-3/nanoquiz': { value: 5 } },
          ]);
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
        done();
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
