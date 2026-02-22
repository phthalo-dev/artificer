import type { InstanceCredentials } from './types';

export function generateUserData(credentials: InstanceCredentials): string {
  const {
    opencodePassword,
    anthropicApiKey,
    githubToken,
    githubSshKey,
    workDirectory,
  } = credentials;

  return `#!/bin/bash
set -e

echo "=== Starting Artificer Agent Setup ==="

# Update system
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y

# Install dependencies
apt-get install -y curl git unzip build-essential

# Install Node.js 22
if ! command -v node &> /dev/null || [[ "$(node -v | cut -d'.' -f1 | tr -d 'v')" != "22" ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
fi

# Install OpenCode
npm install -g opencode-ai

# Create workspace directory
mkdir -p ${workDirectory}
cd ${workDirectory}

# Configure Git
git config --global user.email "agent@artificer.io"
git config --global user.name "Artificer Agent"
git config --global init.defaultBranch main
git config --global pull.rebase false

# Setup SSH for GitHub
mkdir -p ~/.ssh
cat > ~/.ssh/id_ed25519 << 'SSHKEY'
${githubSshKey}
SSHKEY
chmod 600 ~/.ssh/id_ed25519

cat > ~/.ssh/known_hosts << 'KNOWNHOSTS'
github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl
KNOWNHOSTS

# Configure GitHub token
git config --global credential.helper store
echo "https://x-access-token:${githubToken}@github.com" > ~/.git-credentials

# Configure OpenCode
mkdir -p ~/.config/opencode
cat > ~/.config/opencode/opencode.json << 'OPENCODE'
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "bash": "allow",
    "edit": "allow"
  }
}
OPENCODE

# Set environment variables for OpenCode server
cat > /etc/environment << 'ENV'
ANTHROPIC_API_KEY=${anthropicApiKey}
OPENCODE_SERVER_PASSWORD=${opencodePassword}
ENV

export ANTHROPIC_API_KEY=${anthropicApiKey}
export OPENCODE_SERVER_PASSWORD=${opencodePassword}

# Create OpenCode server startup script
cat > /usr/local/bin/opencode-server.sh << 'SCRIPT'
#!/bin/bash
cd ${workDirectory}
export ANTHROPIC_API_KEY=${anthropicApiKey}
export OPENCODE_SERVER_PASSWORD=${opencodePassword}
opencode serve --port 4096 --hostname 0.0.0.0 --cors "*"
SCRIPT
chmod +x /usr/local/bin/opencode-server.sh

# Enable passwordless sudo for ubuntu user (required for some dev tools)
echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

# Install additional tools
npm install -g npm

# Setup log rotation
cat > /etc/logrotate.d/artificer-agent {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 0640 root root
    /var/log/artificer-agent.log
}

# Create log file
mkdir -p /var/log
touch /var/log/artificer-agent.log

# Start OpenCode server
cd ${workDirectory}
export ANTHROPIC_API_KEY=${anthropicApiKey}
export OPENCODE_SERVER_PASSWORD=${opencodePassword}
nohup opencode serve --port 4096 --hostname 0.0.0.0 --cors "*" > /var/log/artificer-agent.log 2>&1 &

echo "=== Artificer Agent Setup Complete ==="
echo "OpenCode server running on port 4096"
`;
}
