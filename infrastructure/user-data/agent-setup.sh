#!/bin/bash
set -e

echo "Starting Artificer Agent setup..." | tee -a /var/log/artificer-agent.log

export DEBIAN_FRONTEND=noninteractive

echo "Updating system..." | tee -a /var/log/artificer-agent.log
apt-get update
apt-get upgrade -y

echo "Installing dependencies..." | tee -a /var/log/artificer-agent.log
apt-get install -y \
    curl \
    git \
    wget \
    build-essential \
    ca-certificates \
    gnupg \
    lsb-release \
    jq \
    unzip \
    sudo

echo "Installing Node.js..." | tee -a /var/log/artificer-agent.log
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "Installing OpenCode..." | tee -a /var/log/artificer-agent.log
npm install -g opencode-ai

echo "Creating workspace directory..." | tee -a /var/log/artificer-agent.log
mkdir -p /home/ubuntu/workspace
chown -R ubuntu:ubuntu /home/ubuntu/workspace

echo "Setting up Git configuration..." | tee -a /var/log/artificer-agent.log
git config --global user.email "${GITHUB_EMAIL}"
git config --global user.name "${GITHUB_USERNAME}"
git config --global init.defaultBranch main
git config --global pull.rebase false

echo "Setting up SSH for GitHub..." | tee -a /var/log/artificer-agent.log
mkdir -p /home/ubuntu/.ssh
chmod 700 /home/ubuntu/.ssh

echo "${GITHUB_SSH_KEY}" > /home/ubuntu/.ssh/id_ed25519
chmod 600 /home/ubuntu/.ssh/id_ed25519
chown -R ubuntu:ubuntu /home/ubuntu/.ssh

echo "Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
    StrictHostKeyChecking no" > /home/ubuntu/.ssh/config

echo "Setting up OpenCode configuration..." | tee -a /var/log/artificer-agent.log
mkdir -p /home/ubuntu/.config/opencode
cat > /home/ubuntu/.config/opencode/config.yaml << 'OPENCODECONFIG'
version: "1.0"
server:
  host: 0.0.0.0
  port: 4096
  allow_origins:
    - "*"
  session:
    storage: memory
logging:
  level: info
  format: json
providers:
  anthropic:
    api_key: ${ANTHROPIC_API_KEY}
OPENCODECONFIG

chown -R ubuntu:ubuntu /home/ubuntu/.config

echo "Installing language servers..." | tee -a /var/log/artificer-agent.log
npm install -g typescript-language-server
npm install -g pyright

echo "Creating systemd service for OpenCode..." | tee -a /var/log/artificer-agent.log
cat > /etc/systemd/system/opencode.service << 'SYSTEMDUNIT'
[Unit]
Description=OpenCode AI Coding Agent
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/workspace
Environment=ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
Environment=GITHUB_TOKEN=${GITHUB_TOKEN}
Environment=OPENCODE_PORT=4096
ExecStart=/usr/local/bin/opencode serve --host 0.0.0.0 --port 4096
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
SYSTEMDUNIT

echo "Enabling and starting OpenCode service..." | tee -a /var/log/artificer-agent.log
systemctl daemon-reload
systemctl enable opencode
systemctl start opencode

echo "Checking OpenCode status..." | tee -a /var/log/artificer-agent.log
sleep 5
systemctl status opencode | tee -a /var/log/artificer-agent.log

echo "Verifying OpenCode is listening on port 4096..." | tee -a /var/log/artificer-agent.log
sleep 2
netstat -tlnp | grep 4096 || ss -tlnp | grep 4096 || echo "Port check: waiting for OpenCode to start..."

echo "Setup complete!" | tee -a /var/log/artificer-agent.log
