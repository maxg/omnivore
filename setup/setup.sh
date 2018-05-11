#!/bin/bash

cd "$1"

postgresql_version='9.6'

# Apt Repositories
cat > /etc/apt/sources.list.d/nodesource.list <<< 'deb https://deb.nodesource.com/node_6.x trusty main'
wget -qO - https://deb.nodesource.com/gpgkey/nodesource.gpg.key | apt-key add -
cat > /etc/apt/sources.list.d/pgdg.list <<< "deb http://apt.postgresql.org/pub/repos/apt/ trusty-pgdg main $postgresql_version"
wget -qO - https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add -
apt-get update

# Development
apt-get install -y git

# Node
apt-get install -y nodejs build-essential

# for pg package
apt-get install -y libpq-dev

# PostgreSQL client
apt-get install -y postgresql-client

# for GitHub downloads
apt-get install -y unzip

# Pgweb
pgweb_tag=$(
  curl --silent --head https://github.com/sosedoff/pgweb/releases/latest |
    grep '^Location: ' | grep -o '[^/]*$' | tr -d '\r'
)
pgweb_zip=pgweb_linux_amd64.zip
(
  cd pgweb
  curl -LO "https://github.com/sosedoff/pgweb/releases/download/$pgweb_tag/$pgweb_zip"
  unzip -o "$pgweb_zip" && rm "$pgweb_zip"
)

# SSL
(
  cd config
  # Fetch CA certificate
  [ -f ssl-ca.pem ] || wget -q -O - http://ca.mit.edu/mitClient.crt | openssl x509 -inform der -out ssl-ca.pem
  # Generate self-signed certificate
  [ -f ssl-private-key.pem ] || openssl genrsa -out ssl-private-key.pem 2048
  [ -f ssl-certificate.pem ] || openssl req -new -key ssl-private-key.pem -config ../setup/openssl.conf | openssl x509 -req -signkey ssl-private-key.pem -out ssl-certificate.pem
)

# Time zone
timedatectl set-timezone America/New_York
