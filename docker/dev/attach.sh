#!/usr/bin/env bash
# Open a shell inside a running service of the dev stack.
#   ./attach.sh            → api
#   ./attach.sh web
# (db and core-api live in forvia-core's stack — use its own attach.sh.)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE="${1:-api}"

compose() {
    "$SCRIPT_DIR/run.sh" "$@"
}

if ! compose ps --status running --services | grep -qx "$SERVICE"; then
    echo "Service '$SERVICE' is not running. Start the stack with ./run.sh first." >&2
    echo "Running services: $(compose ps --status running --services | tr '\n' ' ')" >&2
    exit 1
fi

compose exec "$SERVICE" sh
