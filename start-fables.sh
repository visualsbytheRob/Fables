#!/bin/bash
# Runnable / double-clickable launcher for Linux.
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

[ -d node_modules ] || { echo "  First-time setup: downloading components..."; pnpm install || exit 1; }
[ -f apps/server/dist/server.js ] || { echo "  First-time setup: building Fables..."; pnpm build || exit 1; }

echo
echo "  Starting Fables. Keep this window open while you use it."
( sleep 2; xdg-open "http://localhost:4870" >/dev/null 2>&1 ) &
pnpm start
