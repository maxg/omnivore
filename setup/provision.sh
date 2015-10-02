#!/bin/bash

set -ex

# Wait for instance configuration to finish
while [ ! -f /var/lib/cloud/instance/boot-finished ]; do sleep 2; done

# Go to app directory & obtain application code
mkdir /var/$APP
cd /var/$APP
tar xf /tmp/$APP.tar
chown -R $ADMIN:$ADMIN /var/$APP

# Create daemon user
adduser --system $APP

# App provisioning
source setup/setup.sh /var/$APP

# Set permissions on sensitive directories
chown $APP:$ADMIN config log
chmod 770 config log

# Allow app to bind to well-known ports
apt-get install -y authbind
for port in 80 443; do
  touch /etc/authbind/byport/$port
  chown $APP /etc/authbind/byport/$port
  chmod u+x /etc/authbind/byport/$port
done

# Install Node.js packages
npm install

# XXX unattended upgrades !!!
