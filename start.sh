#!/usr/bin/env bash
# Pholama launcher. Add HOST=0.0.0.0 to chat from your phone on the same WiFi.
cd "$(dirname "$0")"
NODE=node; [ -x "$HOME/.pholama/node/bin/node" ] && ! command -v node >/dev/null 2>&1 && NODE="$HOME/.pholama/node/bin/node"
exec "$NODE" server/server.js
