FROM node:22-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    python3-pip \
    jq \
    curl \
    build-essential \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Configure git defaults
RUN git config --global init.defaultBranch main \
    && git config --global core.autocrlf false \
    && git config --global pull.rebase false

# Create workspace directory
WORKDIR /workspace

# Keep the container running
CMD ["sleep", "infinity"]
