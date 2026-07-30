#!/usr/bin/env bash

set -Eeuo pipefail

KIRINUKI_SCRIPT_DIR="$(
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
  pwd -P
)"

if [[ "$(uname -s 2>/dev/null || true)" != "Linux" ]]; then
  printf '%s\n' "Kirinuki Linux 도우미는 현재 Linux만 지원합니다." >&2
  exit 1
fi

KIRINUKI_NODE_COMMAND="${KIRINUKI_NODE_BINARY:-node}"
if ! KIRINUKI_RESOLVED_NODE="$(command -v -- "$KIRINUKI_NODE_COMMAND" 2>/dev/null)"; then
  printf '%s\n' \
    "Node.js 20.9 이상을 찾지 못했습니다." \
    "배포판 패키지 관리자나 https://nodejs.org/ 에서 Node.js와 npm을 설치한 뒤 다시 실행하세요." \
    "이 도우미는 관리자 권한을 자동으로 얻거나 시스템 패키지를 임의로 설치하지 않습니다." >&2
  exit 1
fi

KIRINUKI_NODE_VERSION="$("$KIRINUKI_RESOLVED_NODE" --version 2>/dev/null || true)"
KIRINUKI_NODE_NUMBERS="${KIRINUKI_NODE_VERSION#v}"
IFS=. read -r KIRINUKI_NODE_MAJOR KIRINUKI_NODE_MINOR _ \
  <<< "$KIRINUKI_NODE_NUMBERS"
if [[ ! "$KIRINUKI_NODE_MAJOR" =~ ^[0-9]+$ \
  || ! "$KIRINUKI_NODE_MINOR" =~ ^[0-9]+$ \
  || "$KIRINUKI_NODE_MAJOR" -lt 20 \
  || ( "$KIRINUKI_NODE_MAJOR" -eq 20 && "$KIRINUKI_NODE_MINOR" -lt 9 ) ]]; then
  printf '%s\n' \
    "현재 Node.js는 ${KIRINUKI_NODE_VERSION:-알 수 없음}입니다." \
    "Kirinuki에는 Node.js 20.9 이상이 필요합니다." >&2
  exit 1
fi

KIRINUKI_TSX_CLI="$KIRINUKI_SCRIPT_DIR/node_modules/tsx/dist/cli.mjs"
if [[ ! -f "$KIRINUKI_TSX_CLI" ]]; then
  if ! KIRINUKI_RESOLVED_NPM="$(command -v -- npm 2>/dev/null)"; then
    printf '%s\n' \
      "TypeScript 실행 도구를 준비하려면 npm이 필요합니다." \
      "Node.js와 npm을 설치한 뒤 ./setup.sh를 다시 실행하세요." >&2
    exit 1
  fi
  printf '%s\n' "최초 실행용 고정 TypeScript 도구를 준비합니다."
  (
    cd -- "$KIRINUKI_SCRIPT_DIR"
    "$KIRINUKI_RESOLVED_NPM" ci --ignore-scripts
  )
fi

exec "$KIRINUKI_RESOLVED_NODE" \
  "$KIRINUKI_TSX_CLI" \
  "$KIRINUKI_SCRIPT_DIR/scripts/linux-helper.ts" \
  "$@"
