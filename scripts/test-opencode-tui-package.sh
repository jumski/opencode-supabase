#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACT_DIR="${1:-${TMPDIR:-/tmp}/opencode-supabase-tui-$RANDOM}"
OPENCODE_BIN="${OPENCODE_BIN:-$(command -v opencode)}"
SOCKET="tmux.sock"
SESSION="opencode-supabase-$$"
PASSED=false

mkdir -p "$ARTIFACT_DIR"/{home,tmp,config,data,cache,state,runtime,config-dirs,data-dirs,work,package}
chmod 700 "$ARTIFACT_DIR/runtime"
cd "$ARTIFACT_DIR"

diagnostics() {
  tmux -S "$SOCKET" capture-pane -p -t "$SESSION" -S - >"$ARTIFACT_DIR/pane.txt" 2>/dev/null || true
  "$OPENCODE_BIN" --version >"$ARTIFACT_DIR/opencode-version.txt" 2>&1 || true
  if [[ -n "${TARBALL:-}" && -f "$TARBALL" ]]; then
    sha256sum "$TARBALL" >"$ARTIFACT_DIR/tarball.sha256"
    tar -tzvf "$TARBALL" >"$ARTIFACT_DIR/tarball-contents.txt"
  fi
  for file in "$ARTIFACT_DIR/work/.opencode/opencode.json" "$ARTIFACT_DIR/work/.opencode/tui.json"; do
    [[ -f "$file" ]] && { printf '=== %s ===\n' "$file"; cat "$file"; }
  done >"$ARTIFACT_DIR/plugin-metadata.txt" 2>&1 || true
  if [[ "$PASSED" != true ]]; then
    printf 'OpenCode TUI regression failed. Diagnostics retained: %s\n' "$ARTIFACT_DIR" >&2
    for file in install.stdout install.stderr pane.txt tui.stderr opencode-version.txt tarball.sha256 plugin-metadata.txt; do
      [[ -f "$ARTIFACT_DIR/$file" ]] && { printf '\n=== %s ===\n' "$file" >&2; cat "$ARTIFACT_DIR/$file" >&2; }
    done
  fi
  tmux -S "$SOCKET" kill-server 2>/dev/null || true
  rm -f "$SOCKET"
}
trap diagnostics EXIT INT TERM

PACK_JSON="$(cd "$ROOT" && npm pack --json --pack-destination "$ARTIFACT_DIR/package")"
TARBALL="$ARTIFACT_DIR/package/$(jq -r '.[0].filename' <<<"$PACK_JSON")"
printf '%s\n' "$PACK_JSON" >"$ARTIFACT_DIR/npm-pack.json"

# OpenCode 1.17.14 reads package metadata beside file: tarballs before registering them.
tar -xzf "$TARBALL" -C "$ARTIFACT_DIR/package" --strip-components=1

git -C "$ARTIFACT_DIR/work" init -q
clean_env=(
  env -i
  "PATH=$PATH"
  "HOME=$ARTIFACT_DIR/home"
  "TMPDIR=$ARTIFACT_DIR/tmp"
  "XDG_CONFIG_HOME=$ARTIFACT_DIR/config"
  "XDG_DATA_HOME=$ARTIFACT_DIR/data"
  "XDG_CACHE_HOME=$ARTIFACT_DIR/cache"
  "XDG_STATE_HOME=$ARTIFACT_DIR/state"
  "XDG_RUNTIME_DIR=$ARTIFACT_DIR/runtime"
  "XDG_CONFIG_DIRS=$ARTIFACT_DIR/config-dirs"
  "XDG_DATA_DIRS=$ARTIFACT_DIR/data-dirs"
)

(
  cd "$ARTIFACT_DIR/work"
  "${clean_env[@]}" "$OPENCODE_BIN" plugin "file://$TARBALL" --print-logs --log-level DEBUG
) >"$ARTIFACT_DIR/install.stdout" 2>"$ARTIFACT_DIR/install.stderr"

grep -q 'Plugin package ready' "$ARTIFACT_DIR/install.stdout"
for metadata in opencode.json tui.json; do
  jq -e --arg spec "file://$TARBALL" '.plugin == [$spec]' "$ARTIFACT_DIR/work/.opencode/$metadata" >/dev/null
done

cat >"$ARTIFACT_DIR/launch.sh" <<EOF
#!/bin/sh
exec env -i PATH="$PATH" HOME="$ARTIFACT_DIR/home" TMPDIR="$ARTIFACT_DIR/tmp" XDG_CONFIG_HOME="$ARTIFACT_DIR/config" XDG_DATA_HOME="$ARTIFACT_DIR/data" XDG_CACHE_HOME="$ARTIFACT_DIR/cache" XDG_STATE_HOME="$ARTIFACT_DIR/state" XDG_RUNTIME_DIR="$ARTIFACT_DIR/runtime" XDG_CONFIG_DIRS="$ARTIFACT_DIR/config-dirs" XDG_DATA_DIRS="$ARTIFACT_DIR/data-dirs" TERM=xterm-256color "$OPENCODE_BIN" --print-logs --log-level DEBUG 2>"$ARTIFACT_DIR/tui.stderr"
EOF
chmod +x "$ARTIFACT_DIR/launch.sh"

tmux -S "$SOCKET" new-session -d -s "$SESSION" -x 120 -y 40 -c "$ARTIFACT_DIR/work" "$ARTIFACT_DIR/launch.sh"
ready=false
for _ in {1..120}; do
  tmux -S "$SOCKET" capture-pane -p -t "$SESSION" -S - >"$ARTIFACT_DIR/pane.txt"
  if grep -q 'Ask anything' "$ARTIFACT_DIR/pane.txt" && grep -q 'booting location services' "$ARTIFACT_DIR/data/opencode/log/opencode.log" 2>/dev/null; then
    ready=true
    break
  fi
  sleep 1
done
[[ "$ready" == true ]]

tmux -S "$SOCKET" send-keys -t "$SESSION" -l '/supabase'
rendered=false
for _ in {1..15}; do
  tmux -S "$SOCKET" capture-pane -p -t "$SESSION" -S - >"$ARTIFACT_DIR/pane.txt"
  if grep -q 'Connect to Supabase' "$ARTIFACT_DIR/pane.txt"; then
    rendered=true
    break
  fi
  sleep 1
done
[[ "$rendered" == true ]]

PASSED=true
printf 'OpenCode %s rendered /supabase: Connect to Supabase\n' "$("$OPENCODE_BIN" --version)"
printf 'Plugin metadata: %s/.opencode/{opencode.json,tui.json}\n' "$ARTIFACT_DIR/work"
printf 'Evidence retained: %s\n' "$ARTIFACT_DIR"
