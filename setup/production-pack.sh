#!/bin/bash

set -ex

# Wait for instance configuration to finish
while [ ! -f /var/lib/cloud/instance/boot-finished ]; do sleep 2; done

# Go to app directory & obtain application code
mkdir /var/$APP
cd /var/$APP
tar xf /tmp/$APP.tar

# Create daemon user
adduser --system $APP

# App provisioning
source setup/setup.sh /var/$APP

# Set permissions
chown -R $ADMIN:$ADMIN /var/$APP
chown $APP:$ADMIN backup config log
chmod 770 backup config log

# Allow app to bind to well-known ports
apt-get install -y authbind
for port in 80 443; do
  touch /etc/authbind/byport/$port
  chown $APP /etc/authbind/byport/$port
  chmod u+x /etc/authbind/byport/$port
done

# Install AWS EFS mount helper
(
  cd /tmp
  git clone https://github.com/aws/efs-utils
  cd efs-utils
  ./build-deb.sh
  apt-get install -y ./build/amazon-efs-utils*deb
)

# Install Node.js packages
npm install

# Daemon
cat > /lib/systemd/system/$APP.service <<EOD
[Unit]
After=network.target

[Service]
User=$APP
ExecStart=/var/$APP/bin/$APP

[Install]
WantedBy=multi-user.target
EOD

# Security updates
cat > /etc/apt/apt.conf.d/25auto-upgrades <<< 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
Unattended-Upgrade::Remove-Unused-Dependencies "true";'

# Rotate away logs from provisioning
logrotate -f /etc/logrotate.conf 
