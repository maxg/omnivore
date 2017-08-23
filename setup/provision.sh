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
source setup/setup.sh /var/$APP $APP

# Set permissions on sensitive directories
chown $APP:$ADMIN backup config log
chmod 770 backup config log

# Allow app to bind to well-known ports
apt-get install -y authbind
for port in 80 443; do
  touch /etc/authbind/byport/$port
  chown $APP /etc/authbind/byport/$port
  chmod u+x /etc/authbind/byport/$port
done

# Install Node.js packages
# XXX do this as $APP user?
npm install

# Security updates
cat > /etc/apt/apt.conf.d/25auto-upgrades <<< 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
Unattended-Upgrade::Remove-Unused-Dependencies "true";'
