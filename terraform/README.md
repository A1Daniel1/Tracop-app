# Despliegue con Terraform (AWS Academy Learner Lab)

Infraestructura de la **demo para jurados**: una EC2 con el stack completo (API + worker + PostgreSQL, storage en **S3**, sin MinIO). Los buckets S3 se crean con la AWS CLI (el Learner Lab niega `s3:GetObjectLockConfiguration` por SCP, que el recurso `aws_s3_bucket` consulta al leer el estado).

> Pensada para el **Learner Lab**: sin recursos IAM (la API usa el instance profile del lab para S3), imagen compilada en la propia EC2 (sin ECR) y entorno efímero que se recrea con un `terraform apply`.

## 1. Requisitos

- **Terraform** ≥ 1.5 y **AWS CLI** instalados.
- Lab **iniciado** (`Start Lab`) y credenciales temporales de **AWS Details**.

## 2. Credenciales (locales, nunca en el chat ni en el repo)

```bash
aws configure                          # Access Key + Secret Access Key + región us-east-1
aws configure set aws_session_token    # token de sesión de AWS Details
```

## 3. Crear los buckets S3 (una vez por sesión)

Los nombres por defecto son `tracop-media-demo` y `tracop-web-demo` (variables `media_bucket` y `web_bucket`). Si los cambiás, usá esos valores.

```bash
# Media (privado; fotos y comprobantes)
aws s3api create-bucket --bucket tracop-media-demo --region us-east-1

# Web (público; hosting de la Flutter Web)
aws s3api create-bucket --bucket tracop-web-demo --region us-east-1
aws s3api put-public-access-block --bucket tracop-web-demo --public-access-block-configuration BlockPublicAcls=false,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false
aws s3api put-bucket-website --bucket tracop-web-demo --website-configuration '{"IndexDocument":{"Suffix":"index.html"},"ErrorDocument":{"Key":"index.html"}}'
aws s3api put-bucket-policy --bucket tracop-web-demo --policy '{"Version":"2012-10-17","Statement":[{"Sid":"PublicReadGetObject","Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::tracop-web-demo/*"}]}'
```

## 4. Aplicar

```bash
cd terraform
terraform init
terraform plan
terraform apply
```

## 5. Salidas

```bash
terraform output -raw api_url            # URL para API_BASE_URL de la app
terraform output -raw web_endpoint       # URL pública de la Flutter Web
terraform output -raw media_bucket       # bucket de media
terraform output -raw ssh_private_key_pem > tracop.pem && chmod 600 tracop.pem
terraform output -raw ssh_public_ip      # IP para entrar por SSH
```

Los logs del bootstrap quedan en `/var/log/tracop-bootstrap.log`. El OTP de los usuarios sintéticos se imprime en `docker compose -f docker-compose.aws.yml --env-file .env.demo logs api` dentro de la instancia.

## Notas del lab

- **`instance_profile`**: por defecto `LabInstanceProfile`. Si el lab usa otro nombre, mirá IAM → Roles y ajustá la variable (o dejalo vacío y pasá credenciales S3 estáticas).
- **S3 por CLI**: el SCP del lab niega `s3:GetObjectLockConfiguration`, por eso los buckets no se crean con `aws_s3_bucket`. Si el lab también negara `PutBucketPolicy` o `PutBucketWebsite`, la web quedaría solo en el APK.
- **Efímero**: al terminar la sesión, los recursos se detienen/resetean. `terraform apply` lo levanta de nuevo en minutos (las IP cambian; los buckets persisten).
- **CORS de la web**: tras el primer `apply`, fijá `CORS_ALLOWED_ORIGINS` en la API con `terraform output -raw web_endpoint` para que la web pueda pegarle al backend.
