#!/usr/bin/env bash

set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-ssh-mcp-http}"
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_USER="${RUN_USER:-$(id -un)}"
RUN_GROUP="${RUN_GROUP:-$(id -gn)}"
HTTP_HOST="${HTTP_HOST:-0.0.0.0}"
HTTP_PORT="${HTTP_PORT:-3001}"
HTTP_PATH="${HTTP_PATH:-/mcp}"
HTTP_API_KEY="${HTTP_API_KEY:-}"
ENV_FILE="/etc/default/${SERVICE_NAME}"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

if [ "$(id -u)" -ne 0 ]; then
  echo "Error: this script must be run as root. Try: sudo ./install-systemd.sh" >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "Error: systemctl not found. This host may not use systemd." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is not installed or not in PATH." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not installed or not in PATH." >&2
  exit 1
fi

echo "Installing dependencies and building project in ${INSTALL_DIR}..."
cd "${INSTALL_DIR}"
npm install
npm run build
chmod +x "${INSTALL_DIR}/start-http.sh"

echo "Writing environment file: ${ENV_FILE}"
cat > "${ENV_FILE}" <<EOF
HTTP_HOST=${HTTP_HOST}
HTTP_PORT=${HTTP_PORT}
HTTP_PATH=${HTTP_PATH}
HTTP_API_KEY=${HTTP_API_KEY}
EOF
chmod 600 "${ENV_FILE}"

echo "Writing systemd unit: ${UNIT_FILE}"
cat > "${UNIT_FILE}" <<EOF
[Unit]
Description=SSH MCP HTTP Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${INSTALL_DIR}/start-http.sh
Restart=always
RestartSec=5
User=${RUN_USER}
Group=${RUN_GROUP}
KillSignal=SIGTERM
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

echo "Service installed and started: ${SERVICE_NAME}"
echo "Status: systemctl status ${SERVICE_NAME} --no-pager"
echo "Logs:   journalctl -u ${SERVICE_NAME} -f"
echo "URL:    http://${HTTP_HOST}:${HTTP_PORT}${HTTP_PATH}"
if [ -z "${HTTP_API_KEY}" ]; then
  echo "Warning: HTTP_API_KEY is empty. Set it before running this script in production." >&2
fi
