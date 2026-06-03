#!/bin/bash
set -euo pipefail

exec > >(tee /var/log/artificer-runtime-setup.log) 2>&1

echo "=== Artificer runtime host setup ==="

: "${AWS_REGION:?AWS_REGION required}"
: "${ARTIFICER_ECR_RUNTIME:?ARTIFICER_ECR_RUNTIME required}"
: "${ARTIFICER_ECR_BRIDGE:?ARTIFICER_ECR_BRIDGE required}"
: "${SQS_QUEUE_URL:?SQS_QUEUE_URL required}"
: "${RUNTIME_ENV_SECRET_ARN:?RUNTIME_ENV_SECRET_ARN required}"

imds() {
  local path="$1"
  local token
  token="$(curl -sf -X PUT "http://169.254.169.254/latest/api/token" \
    -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")"
  curl -sf -H "X-aws-ec2-metadata-token: ${token}" \
    "http://169.254.169.254/latest/${path}"
}

RUNTIME_INSTANCE_ID="$(imds meta-data/instance-id)"

export DEBIAN_FRONTEND=noninteractive
dnf install -y docker jq
systemctl enable docker
systemctl start docker

if ! docker compose version >/dev/null 2>&1; then
  mkdir -p /usr/local/lib/docker/cli-plugins
  curl -fsSL "https://github.com/docker/compose/releases/download/v2.24.5/docker-compose-linux-$(uname -m)" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi

DATA_DEVICE=/dev/xvdf
DATA_MOUNT=/data

if [ -b "$DATA_DEVICE" ]; then
  if ! blkid "$DATA_DEVICE" >/dev/null 2>&1; then
    mkfs.ext4 "$DATA_DEVICE"
  fi
  mkdir -p "$DATA_MOUNT"
  if ! grep -q "$DATA_MOUNT" /etc/fstab; then
    echo "$DATA_DEVICE $DATA_MOUNT ext4 defaults,nofail 0 2" >> /etc/fstab
  fi
  mount -a
fi

mkdir -p /opt/artificer

# Fetch runtime .env keys from Secrets Manager (ANTHROPIC_API_KEY, etc.)
if aws secretsmanager get-secret-value \
  --region "$AWS_REGION" \
  --secret-id "$RUNTIME_ENV_SECRET_ARN" \
  --query SecretString --output text > /opt/artificer/runtime.env.raw 2>/dev/null; then
  # Secret may be JSON {"ANTHROPIC_API_KEY":"..."} or KEY=VAL lines
  if grep -q '^{' /opt/artificer/runtime.env.raw; then
    jq -r 'to_entries | .[] | "\(.key)=\(.value)"' /opt/artificer/runtime.env.raw > /opt/artificer/runtime.env
  else
    cp /opt/artificer/runtime.env.raw /opt/artificer/runtime.env
  fi
else
  echo "ARTIFICER_DATA_DIR=/data" > /opt/artificer/runtime.env
  echo "PORT=4100" >> /opt/artificer/runtime.env
  echo "# Add ANTHROPIC_API_KEY via Secrets Manager: $RUNTIME_ENV_SECRET_ARN" >> /opt/artificer/runtime.env
fi

grep -q '^ARTIFICER_DATA_DIR=' /opt/artificer/runtime.env || echo 'ARTIFICER_DATA_DIR=/data' >> /opt/artificer/runtime.env
grep -q '^PORT=' /opt/artificer/runtime.env || echo 'PORT=4100' >> /opt/artificer/runtime.env

cat > /opt/artificer/bridge.env <<EOF
AWS_REGION=$AWS_REGION
SQS_QUEUE_URL=$SQS_QUEUE_URL
RUNTIME_INSTANCE_ID=$RUNTIME_INSTANCE_ID
RUNTIME_URL=http://127.0.0.1:4100
HIBERNATE_IDLE_MS=900000
EOF

aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "${ARTIFICER_ECR_RUNTIME%%/*}"

docker pull "$ARTIFICER_ECR_RUNTIME:latest" || true
docker pull "$ARTIFICER_ECR_BRIDGE:latest" || true

cat > /opt/artificer/docker-compose.yml <<COMPOSE
services:
  runtime:
    image: ${ARTIFICER_ECR_RUNTIME}:latest
    restart: unless-stopped
    ports:
      - "4100:4100"
    env_file:
      - /opt/artificer/runtime.env
    volumes:
      - /data:/data

  bridge:
    image: ${ARTIFICER_ECR_BRIDGE}:latest
    restart: unless-stopped
    network_mode: host
    env_file:
      - /opt/artificer/bridge.env
    depends_on:
      - runtime
COMPOSE

cd /opt/artificer
docker compose pull || true
docker compose up -d

echo "=== Artificer runtime host setup complete ==="
