'use strict';

const path = require('path');

const bunyan = require('bunyan');

const config = require('../config');

let main = require.main ? path.basename(require.main.filename, '.js') : '_console';
let args = process.argv.slice(2).map(s => s.replace(/[^\w.-]+/g, '-'));
let filename = 'log/omnivore-' + [ main ].concat(args).join('-') + '.log';

var streams = [
  { path: filename }
];
if (config.env === 'development') {
  streams.push({ stream: process.stdout });
}

const logger = bunyan.createLogger({
  name: 'omnivore',
  streams: streams,
  serializers: bunyan.stdSerializers,
});

// obtain a category logger
exports.cat = category => logger.child({ in: category });

exports.express = spec => (req, res, next) => {
  let log = exports.cat('express');
  function done() {
    res.removeListener('finish', done);
    res.removeListener('close', done);
    log[res.statusCode < 500 ? 'info' : 'error']({ req: req, res: res });
  }
  if (spec && spec.incoming) { log.info({ req: req }); }
  res.once('finish', done);
  res.once('close', done);
  next();
};
