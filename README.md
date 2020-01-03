Omnivore
========

**Eats records & grades**


Development
-----------

Install [VirtualBox](https://www.virtualbox.org/) and [Vagrant](https://www.vagrantup.com/).

In the project root, `vagrant up` will configure a development VM.
Use `vagrant ssh` to log in.

In `/vagrant`...

Fill in `config/env-development.js` following the example.

Run `bin/serve` to start the web server.

Use `bin/test-{db,node}` to run the tests.


Deployment
----------

Install [Packer](https://www.packer.io/) and [Terraform](https://www.terraform.io/) (*e.g.* with [`brew install`](https://brew.sh/) on macOS).

**On Amazon Web Services**

Fill in `setup/packer.conf.json` following the example.
Run `bin/pack` to generate an AMI, *e.g.*: `bin/pack HEAD`

Fill in `setup/terraform.tfvars` following the example.
It provides variables for both backend (during `init`) and configuration.

Create a SSH keypair in: `~/.ssh/aws_omnivore{,.pub}`

In `setup`...

Run: `terraform init -backend-config=terraform.tfvars`

Then `terraform plan` and `terraform apply`.


Production
----------

`sudo bin/daemon`

`pgremote-web`
