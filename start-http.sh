#!/usr/bin/env bash

set -euo pipefail

HOST="${HTTP_HOST:-0.0.0.0}"
PORT="${HTTP_PORT:-3001}"
PATH_PREFIX="${HTTP_PATH:-/mcp}"
API_KEY="${HTTP_API_KEY:-}"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is not installed or not in PATH." >&2
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "node_modules not found, installing dependencies..."
  npm install
fi

if [ "${SKIP_BUILD:-}" = "1" ]; then
  echo "SKIP_BUILD=1, skipping build step."
elif [ ! -f "build/index.js" ]; then
  echo "build/index.js not found, building project..."
  npm run build
elif find src package.json tsconfig.json -type f -newer build/index.js | grep -q .; then
  echo "Source files are newer than build/index.js, rebuilding project..."
  npm run build
else
  echo "build/index.js is up to date."
fi

ARGS=(
  "build/index.js"
  "--mcp-transport" "http"
  "--http-host" "${HOST}"
  "--http-port" "${PORT}"
  "--http-path" "${PATH_PREFIX}"
)

if [ -n "${API_KEY}" ]; then
  ARGS+=("--http-api-key" "${API_KEY}")
else
  echo "Warning: HTTP_API_KEY is empty. The HTTP MCP server will run without auth." >&2
fi

echo "Starting SSH MCP HTTP server at http://${HOST}:${PORT}${PATH_PREFIX}"
exec node "${ARGS[@]}"
