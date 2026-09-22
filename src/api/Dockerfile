# The image mirrors the repo layout exactly (/app/api/src + /app/packages +
# hoisted /app/node_modules), so relative requires like ../../../packages/logger
# resolve the same way in Docker and on a developer's machine.

FROM node:20-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

# Manifests first so dependency installs stay cached across source edits.
COPY package.json ./
COPY api/package.json                ./api/
COPY packages/database/package.json  ./packages/database/
COPY packages/errors/package.json    ./packages/errors/
COPY packages/fileManager/package.json ./packages/fileManager/
COPY packages/logger/package.json    ./packages/logger/
COPY packages/utils/package.json     ./packages/utils/

RUN npm install --omit=dev --workspaces --include-workspace-root


FROM node:20-alpine AS runner

RUN apk add --no-cache openssl

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules

COPY packages/errors      ./packages/errors
COPY packages/fileManager ./packages/fileManager
COPY packages/logger      ./packages/logger
COPY packages/utils       ./packages/utils

# The Prisma client is generated on the host (`make genPrismaClient`) and
# copied in; it is not regenerated during the build.
COPY packages/database/package.json ./packages/database/package.json
COPY packages/database/index.js     ./packages/database/index.js
COPY packages/database/generated    ./packages/database/generated

# Schema, migrations and seed scripts travel with the image so a deployed stack
# can run `prisma migrate deploy` and seed its admin without exposing the
# database to the host.
COPY packages/database/prisma       ./packages/database/prisma

COPY api/package.json ./api/package.json
COPY api/src          ./api/src

CMD ["node", "api/src/index.js"]
