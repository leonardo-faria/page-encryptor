#!/usr/bin/env bash
# Sets the calling (source) repo's About > Website field to a link that
# unlocks the just-published bundle immediately: the resolved key travels
# in the URL fragment, which the bundle's own runtime already knows how to
# read on load (see CLI.md's "Unlocking from a link"). This never touches
# target-repo -- only the repo this workflow is running in -- which is why
# it uses its own token (source-token) rather than target-token, which may
# not even have access to this repo at all.
set -euo pipefail

: "${GH_TOKEN:?source-token is required}"
: "${SFB_SOURCE_REPO:?}"
: "${SFB_RESOLVED_KEY:?}"

if [ -z "${SFB_PAGES_URL:-}" ]; then
  echo "::error::set-source-website has nothing to link to -- pages-url is empty. This shouldn't happen (enable-pages is forced on for you); check the previous step's log." >&2
  exit 1
fi

echo "::add-mask::$GH_TOKEN"

link="${SFB_PAGES_URL}#key=${SFB_RESOLVED_KEY}"

if gh repo edit "$SFB_SOURCE_REPO" --homepage "$link" >/dev/null 2>&1; then
  echo "Set $SFB_SOURCE_REPO's Website (About section) to the unlocked link."
  echo "source-website-url=$link" >> "$GITHUB_OUTPUT"
  {
    echo "## 🔗 Source repo Website updated"
    echo
    echo "[$SFB_SOURCE_REPO](https://github.com/$SFB_SOURCE_REPO)'s About section now links"
    echo "directly to the unlocked page -- anyone with access to this repo can click"
    echo "through without needing the key separately."
  } >> "$GITHUB_STEP_SUMMARY"
else
  echo "::warning::Could not set the Website field on $SFB_SOURCE_REPO. The bundle was still published successfully -- check source-token's Administration permission on THIS repo (needs 'write'; the default GITHUB_TOKEN needs 'permissions: administration: write' granted explicitly in your workflow), or set it manually." >&2
fi
