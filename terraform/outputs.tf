output "api_url" {
  description = "URL de la API para la app móvil (API_BASE_URL)."
  value       = "http://${aws_instance.app.public_ip}:${var.api_port}"
}

output "ssh_public_ip" {
  description = "IP pública de la EC2 (SSH)."
  value       = aws_instance.app.public_ip
}

output "media_bucket" {
  description = "Bucket S3 privado (fotos y comprobantes), creado por CLI."
  value       = var.media_bucket
}

output "web_endpoint" {
  description = "URL pública de la Flutter Web (bucket S3 configurado por CLI)."
  value       = "http://${var.web_bucket}.s3-website-${var.region}.amazonaws.com"
}

output "ssh_private_key_pem" {
  description = "Clave privada SSH de la EC2. Guardala en un lugar seguro; es sensible."
  value       = tls_private_key.ssh.private_key_pem
  sensitive   = true
}
