#!/usr/bin/env bash
# Pholama launcher. Add HOST=0.0.0.0 to chat from your phone on the same WiFi.
cd "$(dirname "$0")" && exec node server/server.js
