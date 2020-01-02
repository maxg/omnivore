#!/bin/bash

set -x

APP=$1
NAME=$2

# Wait for instance configuration to finish
while [ ! -f /var/lib/cloud/instance/boot-finished ]; do sleep 2; done
sleep 1

# Output and tag SSH host key fingerprints
identity=$(curl -s http://169.254.169.254/latest/dynamic/instance-identity/document)
export AWS_DEFAULT_REGION=$(jq -r .region <<< $identity)
grep --only-matching 'ec2: .*' /var/log/syslog | sed -n '/BEGIN SSH/,/END/p' | tee /dev/fd/2 |
grep --only-matching '.\+ .\+:.\+ .\+ (.\+)' |
while read _ _ hash _ type; do echo "Key=SSH $type,Value=$hash"; done |
xargs -d "\n" aws ec2 create-tags --resources $(jq -r .instanceId <<< $identity) --tags

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

hostname=$(
  openssl x509 -noout -subject -nameopt multiline < ssl-certificate.pem | fgrep commonName | cut -d= -f2 | sed 's/ //g'
)

# Add info to app configuration
cat <<< "const hostname = '$hostname';
// $PG_ID
const host = '$PGHOST';
const password = '$PG_APP_PASSWORD';
$oids
// ---
$(cat env-production.js)" > env-production.js

# Start daemon
sudo systemctl start $APP
