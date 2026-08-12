#!/usr/bin/env bash
# Runs generate-loader.js against SFB_SOURCE_PATH with encryption on, and
# surfaces the key as a masked output + step summary. Never writes the key
# anywhere that leaves this job's own run (see README's "How the key is
# handled" for the boundary this depends on).
set -euo pipefail

: "${SFB_ACTION_PATH:?}"
: "${SFB_SOURCE_PATH:?}"

if [ ! -d "$SFB_SOURCE_PATH" ]; then
  echo "::error::path '$SFB_SOURCE_PATH' does not exist in the checked-out repo." >&2
  exit 1
fi

# Mask before the "+ ..." command echo below can print it: if
# encryption-key came from a caller's own secret, that value is at least
# as sensitive as the resolved bundle key we already mask further down.
[ -n "${SFB_KEY:-}" ] && echo "::add-mask::$SFB_KEY"

# A temp dir outside SFB_SOURCE_PATH: generate-loader.js refuses to write a
# key file inside the directory it is bundling, and the bundle itself must
# not be exclude-able by pointing --out inside the source tree either.
work="$(mktemp -d)"
bundle_file="$work/bundle.html"
key_file="$work/bundle.key"

args=(node "$SFB_ACTION_PATH/scripts/generate-loader.js" "$SFB_SOURCE_PATH"
      --out "$bundle_file" --key-file "$key_file" --quiet)

[ -n "${SFB_ENTRY:-}" ] && args+=(--entry "$SFB_ENTRY")
[ -n "${SFB_TITLE:-}" ] && args+=(--title "$SFB_TITLE")
[ -n "${SFB_KEY:-}" ] && args+=(--key "$SFB_KEY")

if [ -n "${SFB_EXCLUDE:-}" ]; then
  while IFS= read -r pattern; do
    [ -n "$pattern" ] && args+=(--exclude "$pattern")
  done <<< "$SFB_EXCLUDE"
fi

echo "+ ${args[*]}"
"${args[@]}"

if [ ! -s "$bundle_file" ] || [ ! -s "$key_file" ]; then
  echo "::error::generate-loader.js did not produce a bundle and key as expected." >&2
  exit 1
fi

key="$(tr -d '[:space:]' < "$key_file")"
size_human="$(du -h "$bundle_file" | cut -f1)"
size_bytes="$(wc -c < "$bundle_file" | tr -d ' ')"

# Mask before anything else can echo it.
echo "::add-mask::$key"

{
  echo "## 🔒 Encrypted bundle"
  echo
  echo "| | |"
  echo "|---|---|"
  echo "| size | ${size_human} (${size_bytes} bytes) |"
  echo "| key | \`${key}\` |"
  echo
  echo "This key is not stored anywhere else — not in the bundle, not in the"
  echo "target repo. Copy it now. There is no recovery path if it's lost."
} >> "$GITHUB_STEP_SUMMARY"

{
  echo "bundle-file=$bundle_file"
  echo "key=$key"
} >> "$GITHUB_OUTPUT"
