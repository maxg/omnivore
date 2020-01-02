'use strict';

const child_process = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const express = require('express');
const http_proxy = require('http-proxy');
const favicon = require('serve-favicon');
const openidclient = require('openid-client');
const { Passport } = require('passport');
const session = require('cookie-session');

const config = require('../config');
const logger = require('./logger');
const omnivore = require('./omnivore');
const serve_course = require('./serve-course');

const log = logger.log.child({ in: 'serve-frontend' });

async function createAppServer(course) {
  omnivore.types.assert(course, 'function');
  
  const passport = new Passport();
  const openidissuer = await openidclient.Issuer.discover(config.oidc.server);
  passport.use('openid', new openidclient.Strategy({
    client: new openidissuer.Client(config.oidc.client),
    params: { scope: 'openid email profile' },
  }, (tokenset, userinfo, done) => {
    done(null, userinfo.email.replace(`@${config.oidc.email_domain}`, ''));
  }));
  const returnUsername = (username, done) => done(null, username);
  passport.serializeUser(returnUsername);
  passport.deserializeUser(returnUsername);
  
  const app = express();
  
  app.set('view engine', 'pug');
  app.set('x-powered-by', false);
  
  app.use(favicon('web/favicon.ico'));
  app.use('/web', express.static('web'));
  app.use(session({
    name: 'omnivore', secret: config.web_secret,
    secure: true, httpOnly: true, sameSite: 'lax', signed: true, overwrite: true,
  }));
  
  app.use(logger.express(log, { incoming: true }));
  
  app.use(passport.initialize());
  app.use(passport.session());
  app.get('/auth', passport.authenticate('openid', {
    successReturnToOrRedirect: '/',
    failWithError: true,
  }), (req, res, next) => {
    res.status(401).render('401', { error: 'authentication failed' });
  });
  
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
    if ( ! req.user) {
      if (req.method === 'POST') {
        return res.status(401).render('401', { error: 'unauthenticated POST request' });
      }
      req.session.returnTo = req.originalUrl;
      return res.redirect('/auth');
    }
    res.set(serve_course.x_auth_user, req.user);
    next();
  }
  
  return https.createServer({
    key: fs.readFileSync('./config/ssl-private-key.pem'),
    cert: fs.readFileSync('./config/ssl-certificate.pem'),
    ca: fs.readdirSync('./config')
          .filter(f => /ssl-intermediate/.test(f))
          .map(f => fs.readFileSync('./config/' + f)),
  }, app);
}

async function createCourseProxy(hosturl) {
  omnivore.types.assert(hosturl, 'string');
  
  const proxy = http_proxy.createProxyServer();
  
  function course(req, res, next) {
    if (req.path === '/' && ! req.originalUrl.endsWith('/')) {
      return res.redirect(301, req.originalUrl + '/');
    }
    
    let child = fork(res.locals.course, !! req.query.create);
    if ( ! child.omnivore_port) {
      child.once('omnivore_error', err => next(err));
      child.once('omnivore_port', () => handle(child.omnivore_port, req, res, next));
    } else {
      handle(child.omnivore_port, req, res, next);
    }
  }
  
  function fork(course, create) {
    if (fork.children[course]) {
      return fork.children[course];
    }
    log.info({ course }, 'forking');
    let child = fork.children[course] = child_process.fork(path.join(__dirname, 'serve-course'), [ hosturl, course, create ]);
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
  
  return course;
}

exports.main = async function main() {
  const port = config.env === 'production' ? 443 : 4443;
  const hosturl = `https://${config.hostname}${port === 443 ? '' : `:${port}`}`;
  const course = await createCourseProxy(hosturl);
  const server = await createAppServer(course);
  server.listen(port, () => log.info({ address: server.address() }, 'listening'));
  
  const redirect = express();
  redirect.get('*', (req, res) => res.redirect(hosturl + req.path));
  http.createServer(redirect).listen(config.env === 'production' ? 80 : 8080);
}

if (require.main === module) {
  function abort(err) {
    try { log.error({ err }, 'uncaught exception'); } catch (err) { console.error(err); }
    process.exit(1);
  }
  process.on('uncaughtException', abort);
  exports.main().catch(abort);
}
