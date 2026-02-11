#!/usr/bin/env bash
set -e

# Source profile to ensure npm global bin is in PATH
# Use || true to prevent set -e from exiting on profile errors
[ -f "$HOME/.profile" ] && source "$HOME/.profile" 2>/dev/null || true
[ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc" 2>/dev/null || true
[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" 2>/dev/null || true

# Fallback: add common npm global paths (including Homebrew on Apple Silicon)
export PATH="/opt/homebrew/bin:$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
[ -d "$HOME/AppData/Roaming/npm" ] && export PATH="$HOME/AppData/Roaming/npm:$PATH"

echo "Starting OpenClaw Gateway..."

if ! command -v openclaw &>/dev/null; then
    echo "ERROR: OpenClaw is not installed. Please run setup.sh first."
    exit 1
fi

openclaw gateway start --port 28789
