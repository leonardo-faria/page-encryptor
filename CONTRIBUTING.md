# Contributing

Notes for anyone changing this repo — the CLI (`scripts/generate-loader.js`),
the Action (`action.yml` + `scripts/*.sh`), or both.

---

## Repository layout

```
page-encryptor/
├── action.yml           composite GitHub Action wrapping the two scripts below
├── README.md            Action-focused — what Marketplace renders
├── CLI.md               full CLI reference
├── CONTRIBUTING.md      this file
├── scripts/
│   ├── generate-loader.js   the bundler — the whole tool, zero dependencies
│   ├── bundle.sh             runs generate-loader.js, surfaces the key safely
│   └── publish.sh            pushes the bundle to another repo, via `gh`
├── .gitignore           ignores generated bundles and key files
├── .gitattributes       pins *.sh / action.yml to LF regardless of local checkout config
└── docs/
    ├── index.html       the live demo — an encrypted bundle, served by
    │                    GitHub Pages from this folder
    └── .nojekyll        serve it verbatim, without Jekyll reprocessing
```

`docs/index.html` is build output, not source. It was produced by running
`scripts/generate-loader.js` against a small demo site; that site's sources
are not tracked here.

`action.yml` is what `uses: leonardo-faria/page-encryptor@v1` resolves to.
It does its own checkout of the calling repo, then runs `scripts/bundle.sh`
and `scripts/publish.sh` — see [README.md](README.md) for how it's meant to
be used, and [Modifying the Action](#modifying-the-action) below if you're
changing it.

---

## Before you change the CLI

**What this is:** a ~600-line zero-dependency Node script that compresses a
directory into a base64 payload, embeds it in an HTML shell, and ships a
browser runtime that unpacks the payload in memory and serves files to the
app from `blob:` URLs.

Know these three things before you touch it:

1. **The output file must be excluded from its own input.** Every run reads the directory fresh. If `loader.html` is not excluded, run N swallows run N−1 and the file grows without bound. This actually happened: 485 KB → 3.5 MB over five runs. The guard is `excludes.push(relativeOut)` in `main()`. Do not remove it.

2. **Paths come from `process.cwd()` / the `dir` argument, never `__dirname`.** The script is designed to be copied into or pointed at arbitrary projects. Using `__dirname` makes it bundle *itself* instead of the target.

3. **"It rendered" is not proof it worked.** See [Verifying a bundle](CLI.md#verifying-a-bundle). A bundle whose original files still sit next to it on the server will fetch them over the network and look perfect while being completely non-self-contained.

---

## Before you change the Action

`action.yml` + `scripts/*.sh` are a thin wrapper around the CLI, not a
reimplementation — see [Modifying the Action](#modifying-the-action) below
for what that means in practice.

Testing it means actually running the shell scripts against a real repo, not
just reading them or checking `bash -n`. `gh repo create` and `git push` are
real, hard-to-reverse actions against GitHub, so don't execute `publish.sh`
against a real target without the user's go-ahead — the same way you
wouldn't run `git push --force` unprompted. Two bugs below were only caught
this way; neither was visible from re-reading the code.

4. **`${{ }}` is evaluated everywhere in `action.yml`, including inside plain `description:` strings — not just in `outputs.*.value`, step `env`, `run`, and `with`.** An input's description once contained the illustrative text `${{ secrets.YOUR_PAT }}` as an example. GitHub evaluates that eagerly at template-load time, before any step runs, and `secrets` isn't a valid context there — so the *entire action* failed to load (`TemplateValidationException: Unrecognized named-value: 'secrets'`) for anyone using it, from the moment it was tagged. If a description needs to reference an expression-shaped string, write it without the surrounding `${{ }}`, e.g. plain `secrets.YOUR_PAT_NAME` in prose.

5. **`gh repo clone` authenticates itself for that one command, but doesn't leave a durable credential helper behind.** A plain `git push`/`git fetch` later in the same script, in the same shell, will fail with `fatal: could not read Username for 'https://github.com': No such device or address` — git trying to prompt interactively on a runner with no TTY. Fix: call `gh auth setup-git` once, early, before any plain git command — it wires git's own credential helper to `gh`, backed by whatever `GH_TOKEN` is already in the environment.

---

## Modifying the bundler

- **Build-time logic** is plain Node at the top and bottom of `generate-loader.js`: `collectFiles`, `pickEntry`, `buildContainer`, `encryptContainer`, `buildHtml`, `main`.
- **Browser-time logic** is the single function `SFB_RUNTIME`, serialized via `.toString()`. It receives everything through parameters and **must not close over anything in Node scope** — a reference to an outer variable will produce a `ReferenceError` in the browser, not a build error.
- `SFB_SHIM` is nested inside `SFB_RUNTIME` and serialized the same way for injection into the iframe. It reaches the file table through `parent.__SFB__`.
- Adding a file type: extend the `MIME` table in `SFB_RUNTIME`.
- Adding an interception point: add it to `SFB_SHIM` and record it in the shim table in [CLI.md](CLI.md#what-the-shim-intercepts).

After any change, rebuild all four checks and verify each in an empty directory:

| Check | Exercises |
|---|---|
| a gallery built with `container.innerHTML = items.map(…)` | template-rendered markup — the most commonly missed path |
| a page that calls `fetch('data/x.json')` on load | the fetch shim |
| a page with `<script type="module">` importing a sibling | depth-first specifier rewriting |
| any of the above with `--encrypt` | key form, wrong key, correct key |

---

## Modifying the Action

`scripts/bundle.sh` just builds the `node scripts/generate-loader.js …`
argument list and calls it — CLI changes (new flags, changed defaults) apply
to the Action automatically, no changes needed there. `scripts/publish.sh`
is unrelated to bundling; it only pushes an already-built file to another
repo with `gh`. Changing what gets bundled or how encryption works never
requires touching either script.

The Action is versioned with a single floating `v1` tag (same convention as
`actions/checkout@v4`): fixes and changes move the tag forward on the same
commit they're released in, rather than accumulating separate patch tags.
After any change to `action.yml` or `scripts/*.sh`:

```bash
git tag -f v1 -m "..." && git push --force origin v1
```

Then re-verify against a real repo, not just `bash -n` — see gotchas 4 and 5
above for why that specifically matters here.
