'use strict';

const assert = require('assert');
const child_process = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const express = require('express');
const http_proxy = require('http-proxy');
const x509 = require('x509');

const config = require('../config');
const logger = require('./logger');
const log = logger.cat('frontend');
const omnivore = require('./omnivore');

const x_auth_user = 'X-Authenticated-User';

const children = {};

const proxy = http_proxy.createProxyServer();

const app = express();

app.set('view engine', 'jade');
app.set('x-powered-by', false);

// serve static resources
app.use('/web', express.static('web'));

app.use(logger.express({ incoming: true }));

app.param('semester', function(req, res, next, semester) {
  res.locals.course = req.params.clazz + '/' + semester;
  if ( ! omnivore.course_regex.test(res.locals.course)) { return next('route'); }
  next();
});

app.get('/', (req, res, next) => res.render('root'));
app.get('/:clazz', (req, res, next) => res.render('root'));
app.use('/:clazz/:semester', authenticate, course);
app.all('*', (req, res, next) => res.status(404).render('404'));
app.use((err, req, res, next) => {
  log.error(err, 'app error');
  res.status(500).render('500');
});

// certificate authentication for non-API requests
function authenticate(req, res, next) {
  // skip API requests
  if (req.path.startsWith('/api/')) { return next(); }
  
  var cert = req.connection.getPeerCertificate(true);
  // reject client certs not signed by a cert in the CA list
  if ( ! req.connection.authorized) {
    return res.status(401).render('401', { error: req.connection.authorizationError, cert: cert });
  }
  // reject client certs not issued by the correct CA
  if (cert.issuerCertificate.fingerprint !== issuer) {
    return res.status(401).render('401', { error: 'unexpected issuer', cert: cert });
  }
  res.set(x_auth_user, cert.subject.emailAddress.replace('@' + config.cert_domain, ''));
  next();
}

// handle a course request
function course(req, res, next) {
  // canonicalize course root URL
  if (req.path === '/' && ! req.originalUrl.endsWith('/')) {
    return res.redirect(301, req.originalUrl + '/');
  }
  
  let child = children[res.locals.course];
  if ( ! child) {
    child = fork(res.locals.course);
  }
  if ( ! child.omnivore_port) {
    child.once('omnivore_error', err => next(err));
    child.once('omnivore_port', port => handle(port, req, res, next));
  } else {
    handle(child.omnivore_port, req, res, next);
  }
}

// fork a child server process for the given course
function fork(course) {
  log.info({ course: course }, 'forking');
  let child = children[course] = child_process.fork(path.join(__dirname, 'serve-course'), [ course ]);
  child.on('message', msg => {
    if (msg.port) {
      child.omnivore_port = msg.port
      child.emit('omnivore_port', msg.port);
    }
    if (msg.exit) {
      log.info({ course: course }, 'will exit');
      delete children[course];
    }
  });
  child.once('exit', () => {
    log.info({ course: course }, 'did exit');
    if ( ! child.omnivore_port) { child.emit('omnivore_error', 'error accessing course'); }
    delete children[course];
  });
  return child;
}

// proxy a request to the given child server port
function handle(port, req, res, next) {
  proxy.web(req, res, { target: { host: 'localhost', port: port } }, next);
}

proxy.on('proxyReq', function(proxyReq, req, res) {
  proxyReq.setHeader(x_auth_user, res.get(x_auth_user) || ''); // XXX not safe vs. local processes
});

proxy.on('proxyRes', function(proxyRes, req, res) {
  // XXX anything?
});

proxy.on('error', function(err, req, res) {
  log.error(err, 'proxy error');
  res.status(500).render('500', { error: err });
});

let ssl = {
  key: fs.readFileSync('./config/ssl-private-key.pem'),
  cert: fs.readFileSync('./config/ssl-certificate.pem'),
  ca: fs.readdirSync('./config')
        .filter(f => /ssl-ca|ssl-intermediate/.test(f))
        .map(f => fs.readFileSync('./config/' + f)),
  requestCert: true
};
const issuer = x509.parseCert('./config/ssl-ca.pem').fingerPrint;

let port = config.env === 'production' ? 443 : 4443;

let server = https.createServer(ssl, app);
server.listen(port, () => log.info({ address: server.address() }, 'listening'));

let redirect = express();

redirect.get('*', function(req, res, next) {
  if ( ! req.headers.host) { return res.status(400).end(); }
  res.redirect('https://' + req.hostname + (port === 443 ? '' : ':' + port) + req.path);
});

http.createServer(redirect).listen(config.env === 'production' ? 80 : 8080);
