#!/usr/bin/env bash
# Cron wrapper: auto-close round when deadline passes.
# Runs every 5 minutes. No-ops if deadline not reached or already closed.
set -euo pipefail

cd /home/karl/Projects/3cblue
set -a && source .env && set +a

exec /usr/bin/npx tsx src/scripts/auto-close-round.ts 2>&1
