module.exports = {
  hostnames: [ 'omnivore.example.com' ],
  db: {
    host: '/var/run/postgresql',
  },
  db_types: { ltree: 16386, ltree_array: 16389, lquery: 16440, lquery_array: 16443 },
};
