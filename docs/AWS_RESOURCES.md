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

### EC2 — speed-oracle worker
The Binance → RDS tick worker (`services/speed-oracle/`). Single-instance — running >1 replica races the `speed_oracle_latest` upsert. Migrated off Railway W7.

- **Instance ID**: `i-03411906c55af48af`
- **Type**: `t4g.nano` (ARM Graviton, 2 vCPU burst, 0.5 GB RAM) — fits in free tier; ~$3/mo otherwise
- **AMI**: Amazon Linux 2023 (ARM64)
- **AZ / subnet**: `eu-central-1a` / `subnet-0eea01d61ca9976b9`
- **Public IP**: `63.183.214.217`
- **Private IP**: `172.31.25.184`
- **Public DNS**: `ec2-63-183-214-217.eu-central-1.compute.amazonaws.com`
- **Security group**: `sg-0a4270ac6977f474a` (`sooq-staging-oracle-sg`)
  - Inbound: 22/tcp + 3000/tcp from dev IP `94.187.15.255/32`. Updated 2026-05-04 (was `149.3.154.247/32`). If your IP changes, refresh both rules via `aws ec2 authorize-security-group-ingress --group-id sg-0a4270ac6977f474a --ip-permissions 'IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp='"$(curl -s ifconfig.me)"'/32}]' --region eu-central-1` (and the same for port 3000), then revoke the stale rule.
  - Outbound: all (needs Binance WSS + RDS 5432)
- **RDS path**: SG-to-SG — `sg-0a4270ac6977f474a` is allowed inbound on 5432 of `sg-0d2a509aed2180dd2`. Worker connects to RDS endpoint privately within the VPC; no public egress to RDS.
- **SSH key**: `~/.ssh/sooq-oracle.pem` (key pair `sooq-oracle`; pem chmod 0400)
- **SSH command**: `ssh -i ~/.ssh/sooq-oracle.pem ec2-user@63.183.214.217`

**Service layout on the host:**
- `/opt/speed-oracle/` — checked-out worker (rsync'd from `services/speed-oracle/dist/` + `node_modules/` + `package.json`)
- `/etc/speed-oracle.env` — env file, `root:root 0600` (DATABASE_URL, SENTRY_DSN, PORT=3000, NODE_ENV=production)
- `/etc/systemd/system/speed-oracle.service` — systemd unit, `Restart=always`, hardened (`ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`, `NoNewPrivileges=true`)

**Operations:**
```bash
# health check (from dev IP only)
curl -s http://63.183.214.217:3000/health | jq

# remote status
ssh -i ~/.ssh/sooq-oracle.pem ec2-user@63.183.214.217 'sudo systemctl status speed-oracle --no-pager'

# remote logs (live)
ssh -i ~/.ssh/sooq-oracle.pem ec2-user@63.183.214.217 'sudo journalctl -u speed-oracle -f'

# deploy (after building locally with `npm run build` in services/speed-oracle/):
rsync -avz -e 'ssh -i ~/.ssh/sooq-oracle.pem' \
  services/speed-oracle/dist/ services/speed-oracle/package.json services/speed-oracle/node_modules/ \
  ec2-user@63.183.214.217:/opt/speed-oracle/
ssh -i ~/.ssh/sooq-oracle.pem ec2-user@63.183.214.217 'sudo systemctl restart speed-oracle'
```

**⚠️ Worker env file rotation (2026-05-11 incident note):** the worker's
DATABASE_URL lives in `/etc/speed-oracle.env` on the EC2 host. When the
RDS master password rotates (e.g. via Secrets Manager) and you update
`.env.local` + Vercel envs, you MUST also update this file or the next
worker restart will FAIL with `password authentication failed for user
"sooqadmin"` (the live pg pool runs on whatever creds it bootstrapped
with, so the staleness is invisible until a restart). One-liner to
rotate (from dev Mac, no plaintext in shell history):

```bash
grep ^DATABASE_URL= /Users/khaledbaltaji/Desktop/Sooq/.env.local > /tmp/sooq-dburl.txt && \
scp -i ~/.ssh/sooq-oracle.pem /tmp/sooq-dburl.txt ec2-user@63.183.214.217:/tmp/dburl.txt && \
ssh -i ~/.ssh/sooq-oracle.pem ec2-user@63.183.214.217 \
  "sudo sed -i '/^DATABASE_URL=/d' /etc/speed-oracle.env && \
   cat /tmp/dburl.txt | sudo tee -a /etc/speed-oracle.env > /dev/null && \
   rm /tmp/dburl.txt && \
   sudo systemctl restart speed-oracle && sleep 4 && \
   sudo journalctl -u speed-oracle -n 25 --no-pager" && \
rm /tmp/sooq-dburl.txt
```

Auto-rotation on the RDS Secret is DISABLED as of 2026-05-10 (see
MEMORY.md `staging_db_rotation_incident.md`); manual rotations must
update Vercel + .env.local + this env file in lockstep.

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
