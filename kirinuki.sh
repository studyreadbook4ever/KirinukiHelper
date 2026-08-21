#!/usr/bin/env bash

set -Eeuo pipefail

KIRINUKI_SCRIPT_DIR="$(
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
  pwd -P
)"

if ! KIRINUKI_NPM_COMMAND="$(command -v -- npm 2>/dev/null)"; then
  printf '%s\n' \
    "Node.js 22 이상과 npm을 찾지 못했습니다." \
    "https://nodejs.org/ 에서 설치한 뒤 다시 실행하세요." >&2
  exit 1
fi

cd -- "$KIRINUKI_SCRIPT_DIR"
exec "$KIRINUKI_NPM_COMMAND" run studio-server -- "$@"
