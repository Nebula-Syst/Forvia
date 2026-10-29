#!/usr/bin/env bash
# Build and start Forvia's dev stack (api + web), then follow the logs. Ctrl+C stops the
# containers (they are kept, so the next run is fast; `./run.sh down` removes them).
# Extra arguments are passed straight to `docker compose`, e.g. `./run.sh ps`.
#
# Needs forvia-core's dev stack up first — it owns db, core-api and the shared network.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

compose() {
    local env_args=()
    [ -f "$ROOT_DIR/.env" ] && env_args=(--env-file "$ROOT_DIR/.env")
    docker compose -f "$SCRIPT_DIR/docker-compose.yml" "${env_args[@]}" "$@"
}

require_core() {
    if [ -z "$(docker ps -q --filter network=forvia --filter label=com.docker.compose.service=core-api)" ]; then
        echo "core-api is not running on the 'forvia' network." >&2
        echo "Start forvia-core first: <forvia-core checkout>/docker/dev/run.sh" >&2
        exit 1
    fi
}

if [ $# -gt 0 ]; then
    [ "$1" = "up" ] && require_core
    compose "$@"
    exit
fi

require_core
trap 'echo; echo "Stopping containers..."; compose stop' INT TERM

compose up --build -d
compose logs -f &
wait
