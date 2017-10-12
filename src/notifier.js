'use strict';

const slack = require('@slack/client');

const logger = require('./logger');

const omnivore = require('./omnivore');

const Notifier = exports.Notifier = function Notifier(hosturl, omni) {
  omnivore.types.assert(hosturl, 'string');
  omnivore.types.assert(omni, omnivore.Omnivore);
  
  this._hosturl = hosturl;
  this._omni = omni;
  
  this._log = logger.log.child({ in: 'notifier', course: omni.course });
};

function webhook(fn) {
  omnivore.types.assert(fn, 'function');
  
  let withWebhook = function(...args) {
    this._omni.memo.agent('slackbot', (err, agent) => {
      if (err) { return; }
      let { url, channel } = JSON.parse(agent.public_key);
      let webhook = new slack.IncomingWebhook(url, {
        username: 'omnivore', iconEmoji: ':fork_and_knife:', channel,
      });
      fn.apply(this, [ webhook, ...args ]);
    });
  };
  Object.defineProperty(withWebhook, 'name', { value: `[hook]${fn.name}` });
  return withWebhook;
}

function sorted_values(list) {
  return Array.from(new Set(list)).sort();
}

Notifier.prototype.added = webhook(
                           function _added(webhook, agent, rows, upload) {
  omnivore.types.assert(webhook, slack.IncomingWebhook);
  omnivore.types.assert(agent, 'agent');
  omnivore.types.assert(rows, 'row_array');
  omnivore.types.assert(upload, 'object|undefined');
  
  let users = sorted_values(rows.map(row => row.username));
  let keys = sorted_values(rows.map(row => row.key));
  let text = [
    [
      agent,
      `added ${rows.length} grade${rows.length == 1 ? '': 's'}`,
      upload ? 'from' : false,
      upload ? (upload.path ? `<${this._hosturl + upload.path}|upload>` : 'upload') : false,
      upload && upload.username != agent ? `by ${upload.username}` : false,
    ].filter(text => text).join(' '),
    ':bust_in_silhouette: ' + (users.length > 5 ? `${users.length} users` : users.join(', ')),
    ':key: ' + (keys.length > 5 ? `${keys.length} keys` : keys.join(', ')),
  ].join('\n');
  
  webhook.send({ text }, err => {
    if (err) { this._log.warn({ err }, 'notifying added'); }
  });
});

Notifier.prototype.error = webhook(
                           function _error(webhook, err, req, res) {
  let text = [
    (err && err.name ? err.name[0].toUpperCase() + err.name.substring(1) : 'Unknown error') + ':',
    err ? err.message : false,
    req ? `on ${req.method} ${req.url}` : false,
    res && res.locals && res.locals.authagent ? `for agent ${res.locals.authagent}` : false,
    res && res.locals && res.locals.authuser ? `for user ${res.locals.authuser}` : false,
  ].filter(text => text).join(' ');
  
  webhook.send({
    attachments: [ { fallback: text, color: 'danger', text } ],
  }, err => {
    if (err) { this._log.warn({ err }, 'notifying error'); }
  });
});
