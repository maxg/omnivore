#!/bin/bash

cd /vagrant

source setup/setup.sh /vagrant

# PostgreSQL server
apt-get install -y postgresql postgresql-contrib
sudo -u postgres createuser vagrant -d
sudo -u postgres psql -d template1 -c "CREATE EXTENSION ltree"

# pgBadger
pgbadger_tag=$(
  curl --silent --head https://github.com/dalibo/pgbadger/releases/latest |
    grep '^Location: ' | grep -o '[^/]*$' | tr -d '\r'
)
pgbadger_zip="$pgbadger_tag.zip"
(
  cd pgbadger
  curl -LO "https://github.com/dalibo/pgbadger/archive/$pgbadger_zip"
  unzip -o "$pgbadger_zip" && rm "$pgbadger_zip"
  cd pgbadger-${pgbadger_tag#v}
  perl Makefile.PL
  make
)
