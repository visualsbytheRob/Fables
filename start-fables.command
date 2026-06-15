#!/bin/bash
# Double-clickable launcher for macOS. First time: right-click -> Open if macOS
# warns about an unidentified developer.
cd "$(dirname "$0")" || exit 1

# ===== Optional power-ups: remove the "#" and fill in to enable =====
# export ANTHROPIC_API_KEY="sk-ant-..."
# export FABLES_COMFY_URL="http://127.0.0.1:8188"
# export FABLES_OLLAMA_URL="http://127.0.0.1:11434"
# (see the "Add power-ups" section of README.md for the full list)
# ===================================================================

if ! command -v pnpm >/dev/null 2>&1; then
  echo
  echo "  Fables needs two free tools first: Node.js and pnpm."
  echo "  Open README.md and follow \"Install Fables - the gentle, step-by-step guide\"."
  echo
  read -n 1 -s -r -p "  Press any key to close..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "  First-time setup: downloading components (a few minutes, one time)..."
  pnpm install || { read -n 1 -s -r -p "  Setup failed. Press any key..."; exit 1; }
fi
if [ ! -f apps/server/dist/server.js ]; then
  echo "  First-time setup: building Fables (a few minutes, one time)..."
  pnpm build || { read -n 1 -s -r -p "  Build failed. Press any key..."; exit 1; }
fi

echo
echo "  Starting Fables. Keep this window open while you use it."
( sleep 2; open "http://localhost:4870" ) >/dev/null 2>&1 &
pnpm start
