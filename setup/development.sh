#!/bin/bash

set -ex

cd /vagrant

source setup/setup.sh /vagrant vagrant

apt-get install -y python-dev python-oslo.config python-pip

# fix cert validation so bin/openstack doesn't complain every request
apt-get install -y libffi-dev libssl-dev
pip install --upgrade --force-reinstall urllib3[secure]

pip install python-openstackclient python-novaclient python-cinderclient python-glanceclient
