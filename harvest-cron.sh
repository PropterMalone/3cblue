#!/usr/bin/env bash
# Hourly correction harvester for 3CBlue.
# Reads the active round's reveal thread, parses corrections, applies, regens dashboard.
set -euo pipefail

cd /home/karl/Projects/3cblue
set -a && source .env && set +a

exec /usr/bin/npx tsx src/scripts/harvest-corrections.ts 2>&1
