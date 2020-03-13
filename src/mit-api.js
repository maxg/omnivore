'use strict';

const events = require('events');
const http = require('http');
const https = require('https');

const types = require('./omnivore-types');

const MIT_API = exports.MIT_API = function MIT_API({ domain, connection, client_id, client_secret }) {
  types.assert(domain, 'string');
  types.assert(connection, 'object|undefined');
  types.assert(client_id, 'string');
  types.assert(client_secret, 'string');
  
  this._connection = Object.assign({
    headers: { client_id, client_secret },
  }, connection);
  this._connector = this._connection.protocol === 'http:' ? http : https;
  this._endpoints = {
    people: { pending: Promise.resolve(), host: 'mit-people-v3.' + domain, path: '/people/v3/people/' },
  };
}

MIT_API.prototype.person = function _person(username, done) {
  types.assert(username, 'username');
  types.assert(done, 'function');
  
  let people = this._endpoints.people;
  people.pending = people.pending.then(() => {
    let req = this._connector.request(Object.assign({
      host: people.host, path: people.path + username,
    }, this._connection), (res) => {
      res.setEncoding('utf8');
      let json = '';
      res.on('data', chunk => json += chunk);
      res.on('end', () => {
        let result;
        try {
          let item = JSON.parse(json).item;
          result = item ? Object.fromEntries([
            'givenName', 'familyName', 'displayName'
          ].map(k => [ k, item[k] ])) : {};
        } catch (e) {
          return done(e);
        }
        done(null, result);
      });
    }).on('error', done).end();
    return events.once(req, 'response').catch(e => null);
  });
};
