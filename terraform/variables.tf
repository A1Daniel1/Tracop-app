variable "region" {
  description = "Región AWS. Learner Lab suele ser us-east-1."
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "Tipo de instancia EC2 (t3.small: 2 GB para el build del monorepo)."
  type        = string
  default     = "t3.small"
}

variable "ami_id" {
  description = "AMI de Ubuntu 22.04 LTS. Vacío para resolverlo vía SSM (por defecto)."
  type        = string
  default     = ""
}

variable "instance_profile" {
  description = "Nombre del instance profile IAM que adjunta el lab (rol con permisos S3). Verificalo en IAM → Roles. Vacío para no adjuntar ninguno."
  type        = string
  default     = "LabInstanceProfile"
}

variable "media_bucket" {
  description = "Nombre del bucket S3 privado (fotos y comprobantes). Crearlo con la AWS CLI antes del apply (ver README)."
  type        = string
  default     = "tracop-media-demo"
}

variable "web_bucket" {
  description = "Nombre del bucket S3 público (Flutter Web). Crearlo y configurarlo con la AWS CLI antes del apply (ver README)."
  type        = string
  default     = "tracop-web-demo"
}

variable "repo_url" {
  description = "Repositorio del backend (se clona y se compila en la propia EC2; sin ECR). Apunta al fork con el código de despliegue."
  type        = string
  default     = "https://github.com/A1Daniel1/Tracop-app.git"
}

variable "repo_branch" {
  description = "Rama a desplegar."
  type        = string
  default     = "main"
}

variable "api_port" {
  description = "Puerto público de la API."
  type        = number
  default     = 3100
}

variable "ssh_cidr" {
  description = "CIDR desde el que se permite SSH. 0.0.0.0/0 para la demo."
  type        = string
  default     = "0.0.0.0/0"
}
