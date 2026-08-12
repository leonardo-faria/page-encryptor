#!/usr/bin/env bash
# Pushes the bundle produced by bundle.sh to SFB_TARGET_REPO, creating it
# first if requested, and optionally turning on GitHub Pages for it.
set -euo pipefail

: "${GH_TOKEN:?target-token input is required}"
: "${SFB_TARGET_REPO:?target-repo input is required}"
: "${SFB_BUNDLE_FILE:?}"

echo "::add-mask::$GH_TOKEN"

repo="$SFB_TARGET_REPO"
branch="${SFB_TARGET_BRANCH:-main}"
target_path="${SFB_TARGET_PATH:-index.html}"
message="${SFB_COMMIT_MESSAGE:-Update encrypted bundle}"
create_if_missing="${SFB_CREATE_IF_MISSING:-true}"
visibility="${SFB_VISIBILITY:-public}"
enable_pages="${SFB_ENABLE_PAGES:-false}"

if [[ "$repo" != */* ]]; then
  echo "::error::target-repo must be 'owner/name', got '$repo'." >&2
  exit 1
fi

git config --global --add safe.directory '*'

# `gh repo clone` authenticates itself, but that doesn't carry over to the
# plain `git push`/`git fetch` further down — without this, those fail with
# "could not read Username ... No such device or address" (git trying to
# prompt interactively on a runner with no TTY). This wires git's own
# credential helper to gh, so every subsequent git command authenticates
# with the same GH_TOKEN.
gh auth setup-git

if gh repo view "$repo" >/dev/null 2>&1; then
  echo "Target repo $repo already exists."
elif [ "$create_if_missing" = "true" ]; then
  echo "Target repo $repo does not exist — creating it ($visibility)."
  gh repo create "$repo" "--$visibility"
else
  echo "::error::target-repo '$repo' does not exist and create-if-missing is 'false'." >&2
  exit 1
fi

clone_dir="$(mktemp -d)"
gh repo clone "$repo" "$clone_dir" -- --quiet

cd "$clone_dir"

if git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
  git fetch -q origin "$branch"
  git checkout -q "$branch"
else
  # Freshly created (or otherwise branchless) repo: there is nothing to
  # branch from yet.
  echo "Branch '$branch' does not exist on $repo yet — creating it."
  git checkout -q --orphan "$branch"
  git rm -rqf . >/dev/null 2>&1 || true
fi

target_dir="$(dirname "$target_path")"
[ "$target_dir" != "." ] && mkdir -p "$target_dir"
cp "$SFB_BUNDLE_FILE" "$target_path"

if [ "$enable_pages" = "true" ]; then
  nojekyll_path="$target_dir/.nojekyll"
  [ "$target_dir" = "." ] && nojekyll_path=".nojekyll"
  [ -f "$nojekyll_path" ] || touch "$nojekyll_path"
fi

git config user.name "page-encryptor-bot"
git config user.email "actions@users.noreply.github.com"

git add -A -- "$target_path"
if [ "$enable_pages" = "true" ]; then
  nojekyll_path="$target_dir/.nojekyll"
  [ "$target_dir" = "." ] && nojekyll_path=".nojekyll"
  git add -A -- "$nojekyll_path"
fi

if git diff --cached --quiet; then
  echo "Nothing changed — $target_path is already up to date on $branch."
else
  git commit -q -m "$message"
  git push -q origin "HEAD:refs/heads/$branch"
  echo "Pushed to $repo@$branch:$target_path"
fi

target_url="https://github.com/$repo"
echo "target-url=$target_url" >> "$GITHUB_OUTPUT"

pages_url=""
if [ "$enable_pages" = "true" ]; then
  pages_path="/"
  [ "$target_dir" != "." ] && pages_path="/$target_dir"

  # POST creates the Pages site; PUT updates one that already exists (POST
  # fails with 409 in that case). Try both, but don't let either fail the
  # run — the bundle is already pushed by this point, which is the part
  # that matters. A plan that doesn't allow private-repo Pages, or a token
  # missing Administration permission, ends up here too.
  if gh api "repos/$repo/pages" -X POST \
        -f "source[branch]=$branch" -f "source[path]=$pages_path" >/dev/null 2>&1 \
     || gh api "repos/$repo/pages" -X PUT \
        -f "source[branch]=$branch" -f "source[path]=$pages_path" >/dev/null 2>&1; then
    owner="${repo%%/*}"
    name="${repo##*/}"
    pages_url="https://${owner}.github.io/${name}/"
    echo "pages-url=$pages_url" >> "$GITHUB_OUTPUT"
    echo "Pages: $pages_url (may take a minute to build)"
  else
    echo "::warning::Could not enable GitHub Pages on $repo. The bundle was still published successfully — check the repo's Pages settings and the token's Administration permission on it, or enable Pages manually." >&2
  fi
fi

{
  echo "## 📦 Published"
  echo
  echo "- repo: [$repo](https://github.com/$repo)"
  echo "- branch: \`$branch\`"
  echo "- path: \`$target_path\`"
  [ -n "$pages_url" ] && echo "- pages: $pages_url"
} >> "$GITHUB_STEP_SUMMARY"
