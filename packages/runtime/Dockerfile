FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV ARTIFICER_DATA_DIR=/data
ENV PORT=4100

# The agent shells out to git/gh, so they must exist in its own environment.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    git \
    openssh-client \
    ca-certificates \
    curl \
    gnupg \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 4100

CMD ["npx", "tsx", "src/index.ts"]
