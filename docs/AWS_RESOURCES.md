# Sooq AWS Resources

Resource IDs and ARNs for the Sooq AWS environment. **Connection strings, passwords, and IAM keys are NEVER in this file** — they live in AWS Secrets Manager (referenced here by ARN) or Vercel env vars.

| Field | Value |
|---|---|
| AWS account ID | `940161469084` |
| Account alias | sign-in URL: `https://940161469084.signin.aws.amazon.com/console` |
| IAM deploy user | `sooq-deploy` (in `Group` with `AdministratorAccess`) |
| Region (W5+) | `eu-central-1` (Frankfurt) — Bahrain `me-south-1` was first choice but blocked from Lebanese ISP |

## Staging environment

### Networking
- **VPC**: `vpc-02f23b3f13d0ac544` (default VPC, CIDR `172.31.0.0/16`)
- **Subnets** (3 AZs):
  - `subnet-0eea01d61ca9976b9` — `eu-central-1a`
  - `subnet-080f1b85cd32f2964` — `eu-central-1b`
  - `subnet-09c85583c196d518e` — `eu-central-1c`

### RDS PostgreSQL 17.9
- **Identifier**: `sooq-staging-db`
- **Engine**: PostgreSQL `17.9`
- **Class**: `db.t4g.medium` (2 vCPU, 4 GB RAM, ARM Graviton)
- **Storage**: 100 GB gp3, encrypted, 7-day backups
- **Multi-AZ**: false (single-AZ for staging cost — production will be multi-AZ)
- **Master username**: `sooqadmin`
- **Master password secret**: `arn:aws:secretsmanager:eu-central-1:940161469084:secret:rds!db-fc910551-747a-4b28-8abc-f9c271c3a2e7-gki8se` (RDS-managed)
- **Database name**: `sooq`
- **DB subnet group**: `sooq-staging-db-subnets` (all 3 AZs)
- **Security group**: `sg-0d2a509aed2180dd2` (inbound 5432 from dev IP `149.3.154.247/32` only — tighten in W11)
- **Parameter group**: `sooq-staging-pg17` (`shared_preload_libraries = pg_cron`)
- **IAM database auth**: enabled
- **Performance Insights**: enabled
- **Publicly accessible**: yes (locked by SG)
- **Endpoint**: `sooq-staging-db.cl0keqcqsenr.eu-central-1.rds.amazonaws.com:5432`

### S3 buckets
- **`sooq-staging-deposits`** — deposit proof images
  - Versioning: enabled
  - Encryption: SSE-S3 (default)
  - Public access: fully blocked
  - Access pattern: pre-signed URLs only
- **`sooq-staging-thumbnails`** — speed market thumbnails / public assets
  - Versioning: enabled
  - Encryption: SSE-S3 (default)
  - Public access: blocked at bucket policy level; CloudFront-fronted only via OAC
  - Access pattern: read-via-CloudFront (public)

### CloudFront
- **Distribution ID**: `E3FXT85I8OR44E`
- **Domain**: `d36u9ggi9no1rl.cloudfront.net`
- **Origin**: `sooq-staging-thumbnails.s3.eu-central-1.amazonaws.com`
- **Origin Access Control**: `E1HN6E39AAIHIK`
- **Price class**: `PriceClass_100` (US/Europe edge locations only — cheapest)
- **Status**: deploying after creation (~10–15 min)

### Secrets Manager
- RDS-managed master password (referenced via `MasterUserSecret.SecretArn`):
  `arn:aws:secretsmanager:eu-central-1:940161469084:secret:rds!db-fc910551-747a-4b28-8abc-f9c271c3a2e7-gki8se`

## Production environment

Not yet provisioned. W11 (canary cutover) creates production RDS + S3 + CloudFront. Production will have:
- Multi-AZ RDS (db.t4g.large or larger)
- Tighter security group (no dev-IP rules; Vercel IP ranges or RDS Proxy from Lambda)
- Separate IAM users / roles for runtime vs admin
- Production-specific S3 buckets (`sooq-prod-deposits`, `sooq-prod-thumbnails`)
- Separate CloudFront distribution
- Likely AWS Organization sub-account for blast-radius separation

## Cost estimate (staging only)

| Resource | Monthly cost |
|---|---|
| RDS `db.t4g.medium` single-AZ + 100 GB gp3 | ~$30 |
| S3 (deposits + thumbnails, low volume) | ~$1 |
| CloudFront (PriceClass_100, low traffic) | ~$1–5 |
| Data transfer | ~$1–3 |
| Secrets Manager | ~$1 |
| **Total staging** | **~$35–40** |

(RDS Proxy added later: ~$10–15/mo. Production multi-AZ doubles RDS cost.)

## CLI quick reference

```bash
# RDS status
aws rds describe-db-instances --db-instance-identifier sooq-staging-db \
  --query 'DBInstances[0].{Status:DBInstanceStatus,Endpoint:Endpoint.Address}' \
  --output json

# Pull RDS master password from Secrets Manager (only when needed for DB connection)
aws secretsmanager get-secret-value \
  --secret-id 'rds!db-fc910551-747a-4b28-8abc-f9c271c3a2e7-gki8se' \
  --query SecretString --output text | jq -r '.password'

# Connect to RDS via psql
PGPASSWORD=$(aws secretsmanager get-secret-value --secret-id 'rds!db-fc910551-747a-4b28-8abc-f9c271c3a2e7-gki8se' --query SecretString --output text | jq -r '.password') \
  psql -h <endpoint> -U sooqadmin -d sooq

# CloudFront status
aws cloudfront get-distribution --id E3FXT85I8OR44E \
  --query 'Distribution.{Status:Status,Domain:DomainName}' --output json
```

## Provisioning timestamps

- W5 start: 2026-05-02
- RDS staging created: 2026-05-02
- S3 buckets created: 2026-05-02
- CloudFront distribution created: 2026-05-02
- pg_cron extension enabled: TBD (after RDS available)
- Vercel env vars wired to RDS: TBD (W6 / W7)
