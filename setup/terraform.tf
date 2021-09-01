variable "bucket" {}
variable "key" {}
variable "region" {}
variable "access_key" {}
variable "secret_key" {}

variable "web_hosts" {}
variable "le_contact" {}
variable "oidc_host" {}
variable "oidc_id" {}
variable "oidc_secret" {}
variable "oidc_email_domain" {}
variable "mit_domain" {}
variable "mit_id" {}
variable "mit_secret" {}

# terraform init -backend-config=terraform.tfvars
terraform {
  required_version = "~> 1.0.5"
  required_providers {
    aws = { source = "hashicorp/aws" }
    null = { source = "hashicorp/null" }
    random = { source = "hashicorp/random" }
    template = { source = "hashicorp/template" }
  }
  backend "s3" {}
}

locals {
  app = var.key
  name = "${local.app}${terraform.workspace == "default" ? "" : "-${terraform.workspace}"}"
}

provider "aws" {
  access_key = var.access_key
  secret_key = var.secret_key
  region = var.region
}

data "aws_ami" "web" {
  most_recent = true
  filter {
    name = "name"
    values = ["${local.app}-*"]
  }
  owners = ["self"]
}

resource "aws_vpc" "default" {
  cidr_block = "10.0.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "${local.name}-vpc", Terraform = local.name }
}

resource "aws_internet_gateway" "default" {
  vpc_id = aws_vpc.default.id
  tags = { Name = "${local.name}-gateway", Terraform = local.name }
}

resource "aws_route" "internet_access" {
  route_table_id = aws_vpc.default.main_route_table_id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id = aws_internet_gateway.default.id
}

resource "aws_subnet" "a" {
  vpc_id = aws_vpc.default.id
  cidr_block = "10.0.1.0/24"
  availability_zone = "${var.region}a"
  tags = { Name = "${local.name}-1", Terraform = local.name }
}

resource "aws_subnet" "b" {
  vpc_id = aws_vpc.default.id
  cidr_block = "10.0.2.0/24"
  availability_zone = "${var.region}b"
  tags = { Name = "${local.name}-2", Terraform = local.name }
}

resource "aws_db_subnet_group" "default" {
  name = "${local.name}-subnets"
  subnet_ids = [aws_subnet.a.id, aws_subnet.b.id]
  tags = { Terraform = local.name }
}

resource "aws_security_group" "db" {
  name = "${local.name}-security-db"
  vpc_id = aws_vpc.default.id
  tags = { Terraform = local.name }
  
  ingress {
    from_port = 5432
    to_port = 5432
    protocol = "tcp"
    cidr_blocks = [aws_vpc.default.cidr_block]
  }
  
  egress {
    from_port = 0
    to_port = 0
    protocol = "-1"
    cidr_blocks = [aws_vpc.default.cidr_block]
  }
}

resource "random_string" "postgres_master_password" {
  length = 16
  override_special = "!#$%&*()-_=+[]{}<>"
}

resource "random_string" "postgres_app_password" {
  length = 16
  override_special = "!#$%&*()-_=+[]{}<>"
  keepers = { db_id = aws_db_instance.default.id }
}

resource "aws_db_instance" "default" {
  identifier = local.name
  allocated_storage = 5
  max_allocated_storage = 10
  apply_immediately = true
  storage_type = "gp2"
  engine = "postgres"
  engine_version = "11"
  instance_class = "db.t3.micro"
  backup_retention_period = 1
  vpc_security_group_ids = [aws_security_group.db.id]
  db_subnet_group_name = aws_db_subnet_group.default.id
  final_snapshot_identifier = "${local.name}-final"
  username = "postgres"
  password = random_string.postgres_master_password.result
  tags = { Terraform = local.name }
}

resource "aws_subnet" "c" {
  vpc_id = aws_vpc.default.id
  cidr_block = "10.0.3.0/24"
  availability_zone = "${var.region}a"
  tags = {
    Name = "${local.name}-3"
    Terraform = local.name
  }
}

resource "aws_security_group" "nfs" {
  name = "${local.name}-security-nfs"
  vpc_id = aws_vpc.default.id
  tags = {
    Terraform = local.name
  }
  
  ingress {
    from_port = 2049
    to_port = 2049
    protocol = "tcp"
    security_groups = [aws_security_group.web.id]
  }
  
  egress {
    from_port = 0
    to_port = 0
    protocol = "-1"
    security_groups = [aws_security_group.web.id]
  }
}

resource "aws_efs_file_system" "tls" {
  tags = {
    Name = "${local.name}-tls"
    Terraform = local.name
  }
}

resource "aws_efs_mount_target" "tls" {
  file_system_id = aws_efs_file_system.tls.id
  subnet_id = aws_subnet.c.id
  security_groups = [aws_security_group.nfs.id]
}

data "aws_ssm_parameter" "admin_cidr_blocks" {
  name = "/${var.bucket}/admin-cidr-blocks"
}

resource "aws_security_group" "web" {
  name = "${local.name}-security-web"
  vpc_id = aws_vpc.default.id
  tags = { Terraform = local.name }
  
  ingress {
    from_port = 22
    to_port = 22
    protocol = "tcp"
    cidr_blocks = split(",", data.aws_ssm_parameter.admin_cidr_blocks.value)
  }
  
  ingress {
    from_port = 80
    to_port = 80
    protocol = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  ingress {
    from_port = 443
    to_port = 443
    protocol = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  egress {
    from_port = 0
    to_port = 0
    protocol = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_key_pair" "app" {
  key_name = local.name
  public_key = file("~/.ssh/aws_${local.app}.pub")
}

resource "aws_instance" "web" {
  instance_type = "t3a.micro"
  ami = data.aws_ami.web.id
  vpc_security_group_ids = [aws_security_group.web.id]
  subnet_id = aws_subnet.a.id
  associate_public_ip_address = true
  key_name = aws_key_pair.app.id
  root_block_device {
    delete_on_termination = false
  }
  iam_instance_profile = aws_iam_instance_profile.web.name
  user_data = data.template_cloudinit_config.config_web.rendered
  tags = { Name = local.name, Terraform = local.name }
  volume_tags = { Name = local.name }
  provisioner "local-exec" { command = "sleep 45" } // wait for instance to boot
  lifecycle {
    create_before_destroy = true
    ignore_changes = [tags]
  }
}

resource "aws_eip" "web" {
  vpc = true
  tags = { Name = local.name, Terraform = local.name }
}

resource "aws_eip_association" "web_address" {
  instance_id = aws_instance.web.id
  allocation_id = aws_eip.web.id
  provisioner "local-exec" { command = "sleep 15" } // wait for EIP to switch
  lifecycle { create_before_destroy = true }
}

data "template_cloudinit_config" "config_web" {
  part {
    content_type = "text/cloud-config"
    content = <<EOF
write_files:
- encoding: b64
  content: ${base64encode(data.template_file.postgres.rendered)}
  path: /var/${local.app}/config/postgres.vars
- encoding: b64
  content: ${base64encode(data.template_file.env_production.rendered)}
  path: /var/${local.app}/config/env-production.js
  owner: ubuntu
runcmd:
- systemctl enable ${local.app}
EOF
  }
}

resource "random_string" "web_secret" {
  length = 32
}

data "template_file" "postgres" {
  template = file("postgres.vars")
  vars = {
    id = aws_db_instance.default.id
    host = aws_db_instance.default.address
    master_password = random_string.postgres_master_password.result
    app_password = random_string.postgres_app_password.result
  }
}

data "template_file" "env_production" {
  template = file("../config/env-production-template.js")
  vars = {
    web_hosts = join(",", var.web_hosts)
    oidc_host = var.oidc_host
    oidc_id = var.oidc_id
    oidc_secret = var.oidc_secret
    oidc_email_domain = var.oidc_email_domain
    web_secret = random_string.web_secret.result
    mit_domain = var.mit_domain
    mit_id = var.mit_id
    mit_secret = var.mit_secret
  }
}

resource "null_resource" "web_provision" {
  triggers = { web = aws_instance.web.id }
  connection {
    type = "ssh"
    host = aws_eip_association.web_address.public_ip
    user = "ubuntu"
    private_key = file("~/.ssh/aws_${local.app}")
  }
  provisioner "remote-exec" {
    inline = ["/var/${local.app}/setup/production-provision.sh ${local.app} ${local.name} ${join(",", var.web_hosts)} ${var.le_contact} ${aws_efs_file_system.tls.id}"]
  }
}

data "aws_iam_policy_document" "assume_role_ec2" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "web" {
  name = "${local.name}-web-role"
  assume_role_policy = data.aws_iam_policy_document.assume_role_ec2.json
}

data "aws_iam_policy_document" "web_access" {
  statement {
    actions = ["ec2:CreateTags"]
    resources = ["arn:aws:ec2:${var.region}:*:instance/*"]
  }
}

resource "aws_iam_role_policy" "web" {
  name = "${local.name}-web-access"
  role = aws_iam_role.web.id
  policy = data.aws_iam_policy_document.web_access.json
}

resource "aws_iam_instance_profile" "web" {
  name = "${local.name}-web-profile"
  role = aws_iam_role.web.name
  depends_on = [aws_iam_role_policy.web]
}

output "web-address" { value = aws_eip_association.web_address.public_ip }
