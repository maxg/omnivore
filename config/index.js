const { spawnSync } = require('child_process');
const fs = require('fs');

const env = process.env.NODE_ENV || 'development';

const { stdout, error } = spawnSync('psql', [
  '-d', 'template1', '--csv', '-t', '-c', "SELECT typname, oid, typarray FROM pg_type WHERE typname IN ('ltree', 'lquery')",
], { encoding: 'utf8' });
if (error) { throw error; }
const db_types = {};
for (const row of stdout.trim().split('\n')) {
  const [ type, oid, array_oid ] = row.split(',');
  db_types[type] = parseInt(oid);
  db_types[`${type}_array`] = parseInt(array_oid);
}

module.exports = Object.assign(require(`./env-${env}`), { env, db_types });
