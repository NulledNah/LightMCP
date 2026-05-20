#!/usr/bin/env bash
# LightMCP - Linux systemd user service registration
# Installs a systemd user service that starts LightMCP at login.
# No root required — runs under the user's systemd session.
set -euo pipefail

SERVICE_NAME="lightmcp"
SYSTEMD_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_FILE="${SYSTEMD_DIR}/${SERVICE_NAME}.service"

# Detect LightMCP root directory (parent of this script's dir)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIGHTMCP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Find node executable
NODE_EXE="$(command -v node || true)"
if [ -z "$NODE_EXE" ]; then
    echo "[ERROR] Node.js not found. Install Node.js 20+ from https://nodejs.org"
    exit 1
fi

DIST_CLI="${LIGHTMCP_DIR}/dist/cli/index.js"
if [ ! -f "$DIST_CLI" ]; then
    echo "[INFO] Compiled dist not found — building LightMCP..."
    cd "$LIGHTMCP_DIR"
    npm run build
fi

echo "[INFO] Installing systemd user service: $SERVICE_NAME"

mkdir -p "$SYSTEMD_DIR"

cat > "$SERVICE_FILE" << EOF
[Unit]
Description=LightMCP MCP Tool Router
After=network.target

[Service]
Type=simple
ExecStart=${NODE_EXE} ${DIST_CLI} start
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
EOF

echo "   Created: $SERVICE_FILE"

systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME.service"
systemctl --user start "$SERVICE_NAME.service"

echo "   [OK] Service enabled and started"
echo "   Status: systemctl --user status $SERVICE_NAME"
echo "   Stop:   systemctl --user stop $SERVICE_NAME"
echo "   Remove: systemctl --user disable $SERVICE_NAME && rm $SERVICE_FILE && systemctl --user daemon-reload"
