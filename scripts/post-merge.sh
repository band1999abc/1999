#!/bin/bash
# Post-merge setup script — runs automatically after each task merge.
# Must be: idempotent, non-interactive (stdin is closed), fast.
set -e

echo "[post-merge] Starting setup..."

# Install Node packages if package.json changed
if [ -f package.json ]; then
    echo "[post-merge] Running npm install..."
    npm install --prefer-offline 2>&1
fi

echo "[post-merge] Done."
