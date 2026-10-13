#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
DB_PACKAGE="$REPO_ROOT/src/packages/database"

# The base stack keeps PostgreSQL private; only the dev overlay publishes a
# host port. Use the API container's internal DATABASE_URL and dependencies in
# both modes. Stream the current repository seed rather than an older image copy.
# The working directory preserves seed.js's relative require/dotenv paths.
echo "Running the repository seed inside the API container..."
docker compose -f "$REPO_ROOT/src/docker-compose.yml" exec -T \
  --workdir /app/packages/database/prisma api node < "$DB_PACKAGE/prisma/seed.js"
