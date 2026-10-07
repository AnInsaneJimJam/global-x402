#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source_dir=.local/upstream
expected=71455701ac22c3380c50da54089e1b7363f6825d
if [[ ! -e "$source_dir" ]]; then
  mkdir -p .local
  git clone --depth 1 --branch 0.29.0 https://github.com/masumi-network/masumi-payment-service.git "$source_dir"
fi
if [[ "$(git -C "$source_dir" rev-parse HEAD)" != "$expected" ]] ||
   ! git -C "$source_dir" diff --quiet || ! git -C "$source_dir" diff --cached --quiet ||
   [[ -n "$(git -C "$source_dir" ls-files --others --exclude-standard)" ]]; then
  echo 'Source checkout is not the clean pinned revision. Existing files were preserved.' >&2
  exit 1
fi
echo "Verified public Masumi source commit $expected"
