#!/bin/bash

cd /vagrant

source setup/setup.sh /vagrant

# Generate self-signed certificate
(
  cd config
  mkdir -p tls
  [ -f tls/privkey.pem ] || openssl genrsa 2048 > tls/privkey.pem
  [ -f tls/fullchain.pem ] || openssl req -new -key tls/privkey.pem -config ../setup/openssl.conf | openssl x509 -req -signkey tls/privkey.pem -out tls/fullchain.pem
)

# PostgreSQL server
apt-get install -y postgresql postgresql-contrib
sudo -u postgres createuser vagrant -d
sudo -u postgres psql -d template1 -c "CREATE EXTENSION ltree"

# pgBadger
pgbadger_tag=$(
  curl --silent --head https://github.com/darold/pgbadger/releases/latest |
    grep -i '^Location: ' | grep -o '[^/]*$' | tr -d '\r'
)
pgbadger_zip="$pgbadger_tag.zip"
(
  cd pgbadger
  curl -LO "https://github.com/darold/pgbadger/archive/$pgbadger_zip"
  unzip -o "$pgbadger_zip" && rm "$pgbadger_zip"
  cd pgbadger-${pgbadger_tag#v}
  perl Makefile.PL
  make
)
