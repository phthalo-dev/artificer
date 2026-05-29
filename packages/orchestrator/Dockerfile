FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV WORKDIR=/workspace

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    curl \
    git \
    unzip \
    build-essential \
    ca-certificates \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

RUN type -p curl >/dev/null || apt-get install -y curl \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y gh

RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY scripts/setup-agent.sh /tmp/setup-agent.sh
RUN chmod +x /tmp/setup-agent.sh && bash /tmp/setup-agent.sh

WORKDIR ${WORKDIR}

EXPOSE 4096

CMD ["bash", "-c", "opencode serve --port 4096 --hostname 0.0.0.0 --cors '*'"]
