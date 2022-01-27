#!/bin/bash

set -x

APP=$1
NAME=$2
HOSTS=$3
CONTACT=$4
TLS_FS=$5

# Wait for instance configuration to finish
while [ ! -f /var/lib/cloud/instance/boot-finished ]; do sleep 2; done
sleep 1

# Output and tag SSH host key fingerprints
identity=$(curl -s http://169.254.169.254/latest/dynamic/instance-identity/document)
export AWS_DEFAULT_REGION=$(jq -r .region <<< $identity)
grep --only-matching 'cloud-init: .*' /var/log/syslog | sed -n '/BEGIN SSH/,/END/p' | tee /dev/fd/2 |
grep --only-matching '.\+ .\+:.\+ .\+ (.\+)' |
while read _ _ hash _ type; do echo "Key=SSH $type,Value=$hash"; done |
xargs -d "\n" --no-run-if-empty aws ec2 create-tags --resources $(jq -r .instanceId <<< $identity) --tags

cd "$(dirname $0)/../config"

source postgres.vars

export PGUSER=postgres
export PGPASSWORD="$PG_MASTER_PASSWORD"

# Provision database
psql <<< "CREATE ROLE omnivore WITH LOGIN PASSWORD '$PG_APP_PASSWORD' CREATEDB"
psql -d template1 -c "CREATE EXTENSION ltree"
oids=$(
  psql -d template1 -At -c "SELECT 'const '||typname||' = '||oid||', '||typname||'_array = '||typarray||';' FROM pg_type WHERE typname IN ('ltree', 'lquery')"
)

# Add database info to app configuration
cat <<< "// $PG_ID
const host = '$PGHOST';
const password = '$PG_APP_PASSWORD';
$oids
// ---
$(cat env-production.js)" > env-production.js

# Mount TLS filesystem
sudo tee --append /etc/fstab <<< "$TLS_FS:/ /etc/letsencrypt efs tls,_netdev 0 0"
sudo mount /etc/letsencrypt

# Start Certbot
sudo certbot certonly --standalone --non-interactive --agree-tos --email $CONTACT --domains $HOSTS --cert-name $APP
(
  cd /etc/letsencrypt
  sudo tee renewal-hooks/pre/pause <<< 'curl http://localhost/pause'
  sudo chmod +x renewal-hooks/pre/pause
  sudo tee renewal-hooks/post/permit <<EOD
cd /etc/letsencrypt
chmod o+x archive live
chown -R $APP archive/$APP
EOD
  sudo chmod +x renewal-hooks/post/permit
  sudo renewal-hooks/post/permit
)
sudo systemctl --now enable certbot.timer
ln -s /etc/letsencrypt/live/$APP /var/$APP/config/tls

# Start daemon
sudo systemctl start $APP
