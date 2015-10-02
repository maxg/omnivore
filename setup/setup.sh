#!/bin/bash

cd "$1"

wget -qO- https://deb.nodesource.com/gpgkey/nodesource.gpg.key | apt-key add -
echo 'deb https://deb.nodesource.com/node_0.12 trusty main' > /etc/apt/sources.list.d/nodesource.list

add-apt-repository ppa:git-core/ppa

apt-get update

apt-get install -y git nodejs
# NodeGit
apt-get install -y build-essential libssl-dev

apt-get install -y sqlite3

# OpenStack
apt-get install -y python-dev python-pip
pip install python-novaclient python-cinderclient

(
  cd config
  # fetch CA certificate
  [ -f ssl-ca.pem ] || wget -q -O - http://ca.mit.edu/mitClient.crt | openssl x509 -inform der -out ssl-ca.pem
  # generate self-signed certificate
  [ -f ssl-private-key.pem ] || openssl genrsa -out ssl-private-key.pem 2048
  [ -f ssl-certificate.pem ] || openssl req -new -key ssl-private-key.pem -config ../setup/openssl.conf | openssl x509 -req -signkey ssl-private-key.pem -out ssl-certificate.pem
)

# Time zone
cat > /etc/timezone <<< America/New_York
dpkg-reconfigure -f noninteractive tzdata
