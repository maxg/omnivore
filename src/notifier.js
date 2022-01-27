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
  let userlinks = users.length > 5 ? `${users.length} users` : users.map(u => {
    return `<${this._hosturl}/${this._omni.course}/u/${u}|${u}>`;
  }).join(', ');
  let keys = sorted_values(rows.map(row => row.key));
  let keylinks = keys.length > 5 ? `${keys.length} keys` : keys.map(k => {
    return `<${this._hosturl}/${this._omni.course}/grades${k}|${k}>`;
  }).join(', ');
  let text = [
    [
      `[${this._omni.course}]`,
      agent,
      `added ${rows.length} grade${rows.length == 1 ? '': 's'}`,
      upload ? 'from' : false,
      upload ? (upload.path ? `<${this._hosturl + upload.path}|upload>` : 'upload') : false,
      upload && upload.username != agent ? `by ${upload.username}` : false,
    ].filter(text => text).join(' '),
    ':bust_in_silhouette: ' + userlinks,
    ':key: ' + keylinks,
  ].join('\n');
  
  webhook.send({ text }, err => {
    if (err) { this._log.warn({ err }, 'notifying added'); }
  });
});

Notifier.prototype.roster = webhook(
                            function _roster(webhook, agent, usernames, upload) {
  omnivore.types.assert(webhook, slack.IncomingWebhook);
  omnivore.types.assert(agent, 'agent');
  omnivore.types.assert(usernames, 'username_array');
  omnivore.types.assert(upload, 'object|undefined');
  
  let text = [
    [
      `[${this._omni.course}]`,
      agent,
      `updated the <${this._hosturl}/${this._omni.course}/roster/|roster>`,
    ].join(' '),
    ':bust_in_silhouette: ' + usernames.length,
  ].join('\n');
  
  webhook.send({ text }, err => {
    if (err) { this._log.warn({ err }, 'notifying roster'); }
  });
});

Notifier.prototype.warning = webhook(
                             function _warning(webhook, err) {
  let text = [
    `[${this._omni.course}]`,
    (err && err.name ? err.name[0].toUpperCase() + err.name.substring(1) : 'Unknown warning') + ':',
    err ? err.message : false,
  ].filter(text => text).join(' ');
  
  webhook.send({
    attachments: [ { fallback: text, color: 'warning', text } ],
  }, err => {
    if (err) { this._log.warn({ warn }, 'notifying warning'); }
  });
});

Notifier.prototype.error = webhook(
                           function _error(webhook, err, req, res) {
  let text = [
    `[${this._omni.course}]`,
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
