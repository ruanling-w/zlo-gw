#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "[harness] cwd: $ROOT"
echo "[harness] node: $(node --version)"
echo "[harness] npm: $(npm --version)"

if [ ! -d node_modules ]; then
  echo "[harness] node_modules missing; run npm install first"
  exit 1
fi

echo "[harness] running typecheck"
npm run typecheck

echo "[harness] running tests"
npm test
