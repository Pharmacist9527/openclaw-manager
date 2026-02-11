#!/usr/bin/env bash
set -e

# Source profile to ensure node/npm are in PATH
# Use || true to prevent set -e from exiting on profile errors
[ -f "$HOME/.profile" ] && source "$HOME/.profile" 2>/dev/null || true
[ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc" 2>/dev/null || true
[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc" 2>/dev/null || true

# Common npm/node paths (including Homebrew on Apple Silicon)
export PATH="/opt/homebrew/bin:$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
[ -d "$HOME/AppData/Roaming/npm" ] && export PATH="$HOME/AppData/Roaming/npm:$PATH"

echo ""
echo "  OpenClaw Quick Setup"
echo ""

if ! command -v node &>/dev/null; then
    echo "ERROR: Node.js is not installed."
    echo "Please install Node.js 22+ from https://nodejs.org"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install --silent
fi

node bin/setup.js
