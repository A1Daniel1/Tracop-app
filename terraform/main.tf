# Infraestructura de la demo para AWS Academy Learner Lab.
#
# Restricciones del Learner Lab que condicionan este diseño:
#   - NO se puede crear IAM (usuarios, roles ni policies): aquí no hay recursos IAM,
#     y la API usa el instance profile que adjunta el lab para acceder a S3.
#   - Sin credenciales estáticas para GitHub Actions: la imagen se compila EN la EC2
#     (git clone + docker compose build), no hay ECR.
#   - El entorno es efímero (sesión ~4 h): `terraform apply` lo recrea en minutos.
#
# Requiere credenciales temporales del lab en el entorno (no se guardan en el repo).
# Configuralas con `aws configure` y el token de sesión con `aws configure set aws_session_token`.

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}

provider "aws" {
  region = var.region
}

# --- AMI (Ubuntu 22.04 LTS desde el catálogo de EC2; sobreescribible con var.ami_id) ---
# El Learner Lab no expone SSM Parameter Store, así que se busca por catálogo de AMIs.
data "aws_ami" "ubuntu" {
  count       = var.ami_id == "" ? 1 : 0
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

locals {
  ami = var.ami_id != "" ? var.ami_id : data.aws_ami.ubuntu[0].id
}

# --- Sufijo para nombres globalmente únicos ---
resource "random_string" "suffix" {
  length  = 6
  special = false
  upper   = false
}

# --- Buckets S3 (creados con la AWS CLI, no con aws_s3_bucket) ---
# El Learner Lab niega s3:GetObjectLockConfiguration por SCP, y el recurso
# aws_s3_bucket la consulta al leer el estado (falla con AccessDenied). Por eso
# los buckets se crean por CLI (ver README) y aquí solo se referencia el nombre:
#   media_bucket → privado, fotos y comprobantes (la API accede vía instance role).
#   web_bucket   → público, hosting de la Flutter Web (website + policy por CLI).

# --- Clave SSH para entrar a la EC2 ---
resource "tls_private_key" "ssh" {
  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "aws_key_pair" "ssh" {
  key_name   = "tracop-${random_string.suffix.result}"
  public_key = tls_private_key.ssh.public_key_openssh
}

# --- Security group: SSH + API ---
resource "aws_security_group" "app" {
  name        = "tracop-${random_string.suffix.result}"
  description = "TRACOP demo: SSH + API"

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_cidr]
  }

  ingress {
    from_port   = var.api_port
    to_port     = var.api_port
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# --- EC2: clona, compila y levanta el stack demo (sin MinIO, storage en S3) ---
resource "aws_instance" "app" {
  ami                    = local.ami
  instance_type          = var.instance_type
  key_name               = aws_key_pair.ssh.key_name
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = var.instance_profile != "" ? var.instance_profile : null

  user_data = templatefile("${path.module}/user-data.sh.tpl", {
    repo_url     = var.repo_url
    repo_branch  = var.repo_branch
    media_bucket = var.media_bucket
    region       = var.region
    api_port     = var.api_port
  })

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
  }

  tags = { Name = "tracop-${random_string.suffix.result}" }
}
