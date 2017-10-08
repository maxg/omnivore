'use strict';

const child_process = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const express = require('express');
const http_proxy = require('http-proxy');
const favicon = require('serve-favicon');
const x509 = require('x509');

const config = require('../config');
const logger = require('./logger');
const omnivore = require('./omnivore');
const serve_course = require('./serve-course');

const log = logger.log.child({ in: 'serve-frontend' });

const proxy = http_proxy.createProxyServer();

const app = express();

app.set('view engine', 'pug');
app.set('x-powered-by', false);

app.use(favicon('web/favicon.ico'));
app.use('/web', express.static('web'));

app.use(logger.express(log, { incoming: true }));

app.param('semester', (req, res, next, semester) => {
  res.locals.course = `${req.params.clazz}/${semester}`;
  if ( ! omnivore.types.is(res.locals.course, 'course')) { return next('route'); }
  next();
});

app.get('/', (req, res) => res.render('root'));
app.use('/:clazz/:semester', authenticate, course);
app.all('*', (req, res) => res.status(404).render('404'));
app.use((err, req, res, next) => {
  log.error({ err }, 'app error');
  res.status(500).render('500');
});

function authenticate(req, res, next) {
  if (req.path.startsWith('/api/')) {
    if ( ! req.header(serve_course.x_omni_sign)) {
      return res.status(401).end('signature required for API request');
    }
    res.set(serve_course.x_auth_user, '');
    return next();
  }
  
  var cert = req.connection.getPeerCertificate(true);
  // reject client certs not signed by a cert in the CA list
  if ( ! req.connection.authorized) {
    return res.status(401).render('401', { error: req.connection.authorizationError, cert });
  }
  // reject client certs not issued by the correct CA
  if (cert.issuerCertificate.fingerprint !== issuer) {
    return res.status(401).render('401', { error: 'unexpected issuer', cert });
  }
  res.set(serve_course.x_auth_user, cert.subject.emailAddress.replace('@' + config.cert_domain, ''));
  next();
}

function course(req, res, next) {
  if (req.path === '/' && ! req.originalUrl.endsWith('/')) {
    return res.redirect(301, req.originalUrl + '/');
  }
  
  let child = fork(res.locals.course);
  if ( ! child.omnivore_port) {
    child.once('omnivore_error', err => next(err));
    child.once('omnivore_port', () => handle(child.omnivore_port, req, res, next));
  } else {
    handle(child.omnivore_port, req, res, next);
  }
}

function fork(course) {
  if (fork.children[course]) {
    return fork.children[course];
  }
  log.info({ course }, 'forking');
  let child = fork.children[course] = child_process.fork(path.join(__dirname, 'serve-course'), [ hosturl, course ]);
  child.on('message', msg => {
    if (msg.port) {
      child.omnivore_port = msg.port;
      child.emit('omnivore_port');
    }
    if (msg.exit) {
      log.info({ course }, 'will exit');
      delete fork.children[course];
    }
  });
  child.once('exit', () => {
    log.info({ course }, 'did exit');
    if ( ! child.omnivore_port) { child.emit('omnivore_error', 'error accessing course'); }
    delete fork.children[course];
  });
  return child;
}
fork.children = {};

function handle(port, req, res, next) {
  proxy.web(req, res, { target: { host: 'localhost', port } }, next);
}

proxy.on('proxyReq', (proxyReq, req, res) => {
  proxyReq.setHeader(serve_course.x_auth_user, res.get(serve_course.x_auth_user));
});

proxy.on('error', (err, req, res) => {
  log.error({ err }, 'proxy error');
  res.status(500).render('500', { err });
});

const ssl = {
  key: fs.readFileSync('./config/ssl-private-key.pem'),
  cert: fs.readFileSync('./config/ssl-certificate.pem'),
  ca: fs.readdirSync('./config')
        .filter(f => /ssl-ca|ssl-intermediate/.test(f))
        .map(f => fs.readFileSync('./config/' + f)),
  requestCert: true
};
const issuer = x509.parseCert('./config/ssl-ca.pem').fingerPrint;

const hostname = x509.parseCert('./config/ssl-certificate.pem').subject.commonName;
const port = config.env === 'production' ? 443 : 4443;
const hosturl = `https://${hostname}${port === 443 ? '' : `:${port}`}`;

const server = https.createServer(ssl, app);
server.listen(port, () => log.info({ address: server.address() }, 'listening'));

const redirect = express();

redirect.get('*', (req, res) => res.redirect(hosturl + req.path));

http.createServer(redirect).listen(config.env === 'production' ? 80 : 8080);
