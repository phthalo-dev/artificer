#!/bin/bash
set -e

echo "=== Starting Artificer Agent Setup ==="

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a   # auto-restart services without prompting
# Cloud-init runs without a full shell environment — HOME is not set.
# Set it explicitly so git, npm, and other tools work correctly.
export HOME=/root

# Update system
apt-get update -y
apt-get upgrade -y

# Open port 4096 before anything else so health checks can reach us
ufw allow 4096/tcp || true
ufw allow 22/tcp || true
ufw --force enable || true

# Install dependencies
apt-get install -y curl git unzip build-essential

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install GitHub CLI
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | tee /etc/apt/sources.list.d/github-cli.list > /dev/null
apt-get update -y
apt-get install -y gh

# Install OpenCode
npm install -g opencode-ai

# Create workspace directory owned by ubuntu
mkdir -p /home/ubuntu/workspace
chown ubuntu:ubuntu /home/ubuntu/workspace

# Configure Git for the ubuntu user (opencode runs as ubuntu)
HOME=/home/ubuntu git config --global user.email "${GITHUB_EMAIL:-agent@artificer.io}"
HOME=/home/ubuntu git config --global user.name "${GITHUB_USERNAME:-Artificer Agent}"
HOME=/home/ubuntu git config --global init.defaultBranch main
HOME=/home/ubuntu git config --global pull.rebase false

# Setup SSH for GitHub
mkdir -p /home/ubuntu/.ssh
if [ -n "$GITHUB_SSH_KEY" ]; then
    echo "$GITHUB_SSH_KEY" > /home/ubuntu/.ssh/id_ed25519
    chmod 600 /home/ubuntu/.ssh/id_ed25519
fi

if ! grep -q "github.com" /home/ubuntu/.ssh/known_hosts 2>/dev/null; then
    ssh-keyscan -t ed25519 github.com >> /home/ubuntu/.ssh/known_hosts 2>/dev/null || true
    chmod 644 /home/ubuntu/.ssh/known_hosts
fi

chown -R ubuntu:ubuntu /home/ubuntu/.ssh

# Configure GitHub token for HTTPS operations and gh CLI
if [ -n "$GITHUB_TOKEN" ]; then
    HOME=/home/ubuntu git config --global credential.helper store
    echo "https://x-access-token:${GITHUB_TOKEN}@github.com" > /home/ubuntu/.git-credentials
    chmod 600 /home/ubuntu/.git-credentials
    chown ubuntu:ubuntu /home/ubuntu/.git-credentials

    # Expose GH_TOKEN so the OpenCode systemd service (and any gh commands it
    # spawns) can authenticate without needing a ~/.config/gh login session.
    # gh CLI respects GH_TOKEN automatically — no `gh auth login` needed.
    echo "GH_TOKEN=${GITHUB_TOKEN}" >> /etc/environment
fi

# Configure OpenCode
mkdir -p /home/ubuntu/.config/opencode
cat > /home/ubuntu/.config/opencode/opencode.json << 'OPENCODE'
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "bash": "allow",
    "edit": "allow"
  }
}
OPENCODE
chown -R ubuntu:ubuntu /home/ubuntu/.config

# Set environment variables
if [ -n "$ANTHROPIC_API_KEY" ]; then
    echo "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY" >> /etc/environment
fi

if [ -n "$OPENCODE_SERVER_PASSWORD" ]; then
    echo "OPENCODE_SERVER_PASSWORD=$OPENCODE_SERVER_PASSWORD" >> /etc/environment
fi

# Create OpenCode server startup script
# Sources /etc/environment so the real secret values are available
cat > /usr/local/bin/opencode-server.sh << 'SCRIPT'
#!/bin/bash
set -a
source /etc/environment
set +a
cd /home/ubuntu/workspace
exec opencode serve --port 4096 --hostname 0.0.0.0
SCRIPT
chmod +x /usr/local/bin/opencode-server.sh

# Create systemd service for OpenCode
cat > /etc/systemd/system/opencode.service << 'SYSTEMD'
[Unit]
Description=OpenCode AI Coding Agent
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/workspace
EnvironmentFile=/etc/environment
ExecStart=/usr/local/bin/opencode-server.sh
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SYSTEMD

systemctl daemon-reload
systemctl enable opencode
systemctl start opencode

# Enable passwordless sudo for ubuntu user (required for some dev tools)
if ! grep -q "ubuntu ALL=(ALL) NOPASSWD:ALL" /etc/sudoers 2>/dev/null; then
    echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers
fi

# Setup log rotation
cat > /etc/logrotate.d/artificer-agent << 'LOGROTATE'
/var/log/artificer-agent.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 0640 root root
}
LOGROTATE

touch /var/log/artificer-agent.log

echo "=== Artificer Agent Setup Complete ==="
