variable "bucket" {}
variable "key" {}
variable "region" {}
variable "access_key" {}
variable "secret_key" {}

# terraform init -backend-config=terraform.tfvars
terraform {
  required_version = ">= 0.12"
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
  instance_type = "t3.micro"
  ami = data.aws_ami.web.id
  vpc_security_group_ids = [aws_security_group.web.id]
  subnet_id = aws_subnet.a.id
  associate_public_ip_address = true
  key_name = aws_key_pair.app.id
  root_block_device {
    delete_on_termination = false
  }
  user_data = data.template_cloudinit_config.config_web.rendered
  tags = { Name = local.name, Terraform = local.name }
  volume_tags = { Name = local.name }
  connection {
    type = "ssh"
    host = self.public_ip
    user = "ubuntu"
    private_key = file("~/.ssh/aws_${local.app}")
  }
  provisioner "file" {
    source = "production/"
    destination = "/var/${local.app}"
  }
  provisioner "file" {
    content = data.template_file.postgres.rendered
    destination = "/var/${local.app}/config/postgres.vars"
  }
  provisioner "remote-exec" {
    inline = ["/var/${local.app}/setup/production-provision.sh"]
  }
}

resource "aws_eip" "web" {
  instance = aws_instance.web.id
  vpc = true
  tags = { Name = local.name, Terraform = local.name }
}

data "template_cloudinit_config" "config_web" {
  part {
    content_type = "text/cloud-config"
    content = <<EOF
runcmd:
- systemctl enable ${local.app}
EOF
  }
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

output "web-address" { value = aws_eip.web.public_ip }
