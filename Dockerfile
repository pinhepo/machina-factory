FROM oven/bun:1.2-debian AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock turbo.json ./
COPY packages/tsconfig/ packages/tsconfig/
COPY packages/agent/package.json packages/agent/
COPY packages/sandbox/package.json packages/sandbox/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

RUN bun install --frozen-lockfile

# Copy source
COPY packages/ packages/
COPY apps/api/ apps/api/

EXPOSE 3000

CMD ["bun", "run", "apps/api/src/index.ts"]
