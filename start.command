#!/bin/zsh
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
PORT="${PORT:-4399}"
echo "🃏 正在启动 Royal Hold'em AI Arena (http://127.0.0.1:${PORT}) ..."
(sleep 1 && open "http://127.0.0.1:${PORT}") &
exec node src/server.mjs
