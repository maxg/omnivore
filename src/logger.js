'use strict';

const path = require('path');

const bunyan = require('bunyan');

const config = require('../config');

let main = require.main ? path.basename(require.main.filename, '.js') : '_console';
let args = process.argv.slice(2).map(s => s.replace(/[^\w.-]+/g, '-'));
let filename = `log/omnivore-${[ main, ...args ].join('-')}.log`;

var streams = [ { path: filename } ];
if (config.env === 'development') {
  streams.push({ stream: process.stdout });
}
if (config.env === 'test') {
  streams.forEach(stream => stream.level = 'debug');
}

exports.log = bunyan.createLogger({
  name: 'omnivore',
  streams,
  serializers: bunyan.stdSerializers,
});

exports.express = (log, spec) => (req, res, next) => {
  function done() {
    res.removeListener('finish', done);
    res.removeListener('close', done);
    log[res.statusCode < 500 ? 'info' : 'error']({ req, res });
  }
  if (spec && spec.incoming) { log.info({ req }); }
  res.once('finish', done);
  res.once('close', done);
  next();
};
