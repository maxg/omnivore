const hostnames = '${web_hosts}'.split(',');
module.exports = {
  hostnames,
  oidc: {
    server: 'https://${oidc_host}',
    client: {
      client_id: '${oidc_id}',
      client_secret: '${oidc_secret}',
      redirect_uris: [ 'https://' + hostnames[0] + '/auth' ],
    },
    email_domain: '${oidc_email_domain}',
  },
  web_secret: '${web_secret}',
  db: {
    host,
    password,
  },
  db_types: { ltree, ltree_array, lquery, lquery_array },
  mit: {
    domain: '${mit_domain}',
    client_id: '${mit_id}',
    client_secret: '${mit_secret}',
  },
};
