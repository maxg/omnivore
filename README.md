Omnivore
========

**Eats records & grades**


Development
-----------

Install [VirtualBox](https://www.virtualbox.org/) and [Vagrant](https://www.vagrantup.com/).

In the project root, `vagrant up` will configure a development VM.
Use `vagrant ssh` to log in.

In `/vagrant`...

Run: `npm install`

Fill in `config/env-development.js` following the example.

Run `bin/serve` to start the web server.

Use `bin/test-{db,node}` to run the tests.


Deployment
----------

Install [Packer](https://www.packer.io/) and [Terraform](https://www.terraform.io/) (*e.g.* with [`brew install`](https://brew.sh/) on macOS).

In `setup`...

Fill in `packer.conf.json` following the example.
Run `pack` to generate an AMI, *e.g.*: `./pack HEAD`

Fill in `terraform.tfvars` (which provides variables for both `s3` backend and deployment config) and `terraform.auto.tfvars` following the examples.

Create a SSH keypair in: `~/.ssh/aws_omnivore{,.pub}`

Run: `terraform init -backend-config=terraform.tfvars`

Then `terraform plan` and `terraform apply`.


Production
----------

`bin/pgremote-web` — run with a database name to start `pgweb`; SSH with *e.g.* `LocalForward localhost:8081 localhost:8081` to access by browsing to `localhost`

`bin/pgremote-backup` — `pg_dump` all databases to the `backup` directory

`bin/restore` — run with the relative path to a backup directory to drop and `pg_restore` that database; then run `config/db-schema.sql` in that database to complete the restore
