'use strict';

const http = require('http');

const logger = require('./logger');

const log = logger.log.child({ in: 'serve-redirect' });

exports.listen = function listen(hosturl, port) {
  const server = http.createServer((req, res) => {
    if (req.url === '/pause') {
      res.writeHead(200);
      res.end();
      setTimeout(() => server.close(() => log.info({ enabled: false })), 1);
      setTimeout(() => server.listen(port, () => log.info({ enabled: true })), 1000 * 60);
      return;
    }
    res.writeHead(307, { Location: `${hosturl}${req.url}` });
    res.end();
  });
  server.listen(port, () => {
    log.info({ address: server.address() }, 'redirecting');
    if (port === 0) { port = server.address().port; }
  });
  return server;
};
