const assert = require('assert/strict');

const env = new Proxy({}, {
  get(_, key) {
    const val = process.env[key];
    assert(val, `config ${key} missing`);
    return val;
  }
});

const hostname = env.WEB_HOST;
module.exports = {
  hostname,
  oidc: {
    server: `https://${env.OIDC_HOST}`,
    client: {
      client_id: env.OIDC_ID,
      client_secret: env.OIDC_SECRET,
      redirect_uris: [ 'https://' + hostname + '/auth' ],
    },
    email_domain: env.OIDC_EMAIL_DOMAIN,
  },
  web_secret: env.WEB_SECRET,
  db: {
    ssl: { rejectUnauthorized: false },
  },
  mit: {
    domain: env.MIT_DOMAIN,
    client_id: env.MIT_ID,
    client_secret: env.MIT_SECRET,
  },
};
