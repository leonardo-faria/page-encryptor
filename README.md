# Single-File Web App Bundler

Packs a web project directory into **one self-contained `.html` file**. No dependencies, no build step, no network at runtime.

```bash
node generate-loader.js ./my-site
# → my-site/loader.html
```

Open that file and the app runs. Everything — HTML, CSS, JS, images, JSON, fonts — is inside it.

---

## Live demo

**→ [leonardo-faria.github.io/page-encryptor](https://leonardo-faria.github.io/page-encryptor/)**

```
key:  88RH4SXDtHpLXP81jfEbQlhCqo2XivWenkz_jxPKiFg
```

One 2 MB `.html` file — a 1.1 MB video, six photographs, a stylesheet and a script — encrypted with AES-256-GCM. Paste the key to unlock it.

Once it opens, the page lists the files it was unpacked from. That list is not written into the markup: it asks the runtime holding the decrypted bundle what it has, so the sizes shown are measured. The network tab stays empty the whole time.

This key is published so anyone can open the demo. For a real bundle, send the key separately from the file — see [what encryption does and does not protect](#what-this-does-and-does-not-protect).

---

## For agents reading this first

**What this is:** a ~600-line zero-dependency Node script (`generate-loader.js`) that compresses a directory into a base64 payload, embeds it in an HTML shell, and ships a browser runtime that unpacks the payload in memory and serves files to the app from `blob:` URLs.

**Before you change anything, know these three things:**

1. **The output file must be excluded from its own input.** Every run reads the directory fresh. If `loader.html` is not excluded, run N swallows run N−1 and the file grows without bound. This actually happened: 485 KB → 3.5 MB over five runs. The guard is `excludes.push(relativeOut)` in `main()`. Do not remove it.

2. **Paths come from `process.cwd()` / the `dir` argument, never `__dirname`.** The script is designed to be copied into or pointed at arbitrary projects. Using `__dirname` makes it bundle *itself* instead of the target.

3. **"It rendered" is not proof it worked.** See [Verifying a bundle](#verifying-a-bundle). A bundle whose original files still sit next to it on the server will fetch them over the network and look perfect while being completely non-self-contained.

There is a second surface on top of the CLI: `action.yml` + `scripts/*.sh`
make this repo usable as a GitHub Action (`uses: leonardo-faria/page-encryptor@v1`)
that other repos call to bundle, encrypt, and push to a target repo — see
[GitHub Action](#github-action). It's a thin wrapper; CLI behavior changes
propagate to it automatically. Testing it means running the shell scripts,
not just `generate-loader.js` — `gh repo create` and `git push` are real,
hard-to-reverse actions against GitHub, so don't execute `publish.sh` against
a real target without the user's go-ahead, the same way you wouldn't run
`git push --force` unprompted.

---

## Usage

```bash
node generate-loader.js [dir] [options]
```

| Option | Meaning | Default |
|---|---|---|
| `dir` | Directory to bundle | current directory |
| `-o, --out <file>` | Output filename | `loader.html` |
| `-e, --entry <path>` | Entry HTML, relative to `dir` | shallowest `index.html` |
| `-t, --title <text>` | `<title>` of the output page | directory name |
| `-x, --exclude <pat>` | Extra path to skip; repeatable | — |
| `-q, --quiet` | Only print the summary line | off |
| `-E, --encrypt` | Encrypt the payload; gate the page behind a key form | off |
| `-k, --key-file <f>` | Also write the key to a file (implies `--encrypt`) | — |
| `-h, --help` | Usage | — |

`--out` is resolved **relative to `dir`**, so `node generate-loader.js ./docs -o site.html` writes `docs/site.html`. Pass an absolute path to put it elsewhere.

Always excluded: `.git`, `node_modules`, `.svn`, `.hg`, `.DS_Store`, `Thumbs.db`, `.cache`, `dist`, `build`, `.env`, `.env.local`, `generate-loader.js`, `loader.html`, and the output file itself.

`loader.html` is excluded under any `--out` name, because a bundle left by an earlier run is never app content. Without that rule, `-o new.html` would swallow a stale `loader.html` and roughly double the output.

`--exclude` matches a whole path segment (`-x vendor` skips `vendor/` at any depth) or a path prefix (`-x assets/raw`).

### Examples

```bash
node generate-loader.js                              # bundle current directory
node generate-loader.js ./docs -o site.html          # explicit dir and output
node generate-loader.js . -e app/main.html           # non-standard entry
node generate-loader.js . -x "*.psd" -x raw-assets   # trim large source files
node generate-loader.js ./docs --encrypt             # key-gated bundle
node generate-loader.js ./docs -k ../site.key        # key to console and file
```

---

## How it works

**Build time** (`generate-loader.js`)

1. Walk the directory, skipping excludes and symlinks.
2. Concatenate into a container: `"SFB1" | uint32LE manifestLength | manifest JSON | raw bytes`.
3. `deflateRaw` the whole container, then base64 once.

   Compressing *across* the concatenation exploits redundancy between files, and base64ing last means the 33% inflation applies only to already-compressed bytes. A map app carrying 3.30 MB of JSON packs into a 760 KB HTML file (23%).
4. Emit an HTML shell containing the payload and the runtime, serialized with `Function.prototype.toString()` (so the runtime is written as real, lintable JavaScript rather than an escaped string).

**Run time** (in the browser)

1. base64 → bytes → `DecompressionStream('deflate-raw')` → parse the manifest.
2. Build a lookup table: exact path, plus 1–3 segment suffixes for forgiving matches.
3. Rewrite CSS `url()` in every `.css` file, then link the ES module graph depth-first (see below).
4. Rewrite `src` / `href` / `poster` / `data` / `srcset` / `url()` in the entry HTML to `blob:` URLs.
5. Inject a shim, then write the document into an **`about:blank` iframe** via `document.write`.

### Why `about:blank` and not `srcdoc`

`srcdoc` gives the iframe an **opaque origin**. That breaks `history.pushState`/`replaceState` (throws `SecurityError`), `localStorage`, cookies, and relative URL resolution. An `about:blank` iframe inherits the parent's origin, so all of it behaves normally.

### What the shim intercepts

Static rewriting only covers markup present at bundle time. The shim covers everything else:

| Mechanism | Why it's needed |
|---|---|
| `fetch()` | Runtime data loading — `fetch('data/stops.json')` |
| `XMLHttpRequest` | Older libraries |
| `.src` / `.href` property setters | `img.src = path` |
| `setAttribute('src', …)` | `el.setAttribute` path |
| `innerHTML` / `outerHTML` / `insertAdjacentHTML` | **Template rendering.** `container.innerHTML = items.map(…)` creates elements through the parser, so no setter ever fires. Rewriting the string before parsing avoids a failed request entirely. |
| `document.write` | Legacy injection |
| `MutationObserver` | Safety net for anything above missed. Fires *after* a failed request, so it repairs rather than prevents. |

Anything with a scheme (`https://…`, `//cdn…`) is left alone and goes to the network — external CDNs keep working.

### ES modules

A module served from a `blob:` URL cannot resolve `import './lib.js'` — `blob:` is not a hierarchical scheme, so the specifier throws `Failed to resolve module specifier`. The bundler rewrites each specifier to the imported file's own blob URL, processing the graph depth-first so a dependency's blob exists before its importer is frozen. Bare specifiers (`import 'react'`) are left for an import map or the network.

---

## Encryption

```bash
node generate-loader.js ./site --encrypt
```

```
  site/loader.html  500.2 KB  (134% of source)

  encrypted with AES-256-GCM. key:

      LjeXDIFpCzj10RFHX_WjgswMZIjmJhoArWpFV9JKf4Q

  Store it now — it is not derivable from the bundle, and
  without it the contents are unrecoverable.
```

The bundle opens to a key form instead of the app. On submit the payload is decrypted in memory and boots exactly as an unencrypted bundle would. A wrong key leaves the form up with "Incorrect key."; nothing else about the page changes.

### Design

| Choice | Reason |
|---|---|
| **AES-256-GCM** | Authenticated. A wrong key fails the tag check and throws, so "incorrect key" is detected reliably rather than inferred from garbage output. |
| **Encrypt after compressing** | Ciphertext is incompressible. Compressing first keeps the size win — measured entropy of the stored payload is 7.9994 bits/byte, indistinguishable from random. |
| **Random 256-bit key, not a passphrase** | Full entropy, so no KDF stretching is needed and offline brute force is infeasible. The cost is that the key must be transmitted, not remembered. |
| **base64url encoding** | 43 characters, no `+ / =` to be mangled by a URL or a shell. |
| **Layout `iv(12) ‖ ciphertext ‖ tag(16)`** | WebCrypto expects the tag appended to the ciphertext; Node returns it separately, so the bundler concatenates it. |
| **`crypto.subtle`, no library** | Native, constant-time, zero dependencies. |

### The key

Printed to stdout on every build, including under `--quiet` — losing that line means losing the bundle, and there is no recovery path. `--key-file` also writes it to disk.

Writing the key **inside the directory being bundled is refused**, not warned about:

```
error: Refusing to write the key to ./site/secret.key
  That path is inside the directory being bundled, so the next build
  would embed the key in the encrypted bundle itself.
```

Silently shipping the decryption key inside the thing it decrypts is the worst possible failure here, and nothing about the output would look wrong. `.gitignore` also covers `*.key`, `key.txt` and `mykey.txt`.

### What this does and does not protect

**Does:** the file at rest and in transit. Anyone holding the bundle without the key has 256-bit-random-keyed AES-GCM ciphertext and no way in. Email it, host it publicly, put it on a USB stick.

**Does not:**

- **Protect from the person you gave the key to.** Once decrypted, every file is in browser memory and can be extracted from DevTools. This is access control for delivery, not DRM.
- **Rate-limit anything.** The attacker holds the ciphertext and can attempt keys offline as fast as hardware allows. Security rests entirely on the key being 256 random bits — which is why there is no `--password` option. A memorable passphrase would be the weakest link by orders of magnitude.
- **Hide metadata.** Payload size is visible, which leaks the rough size of the project.
- **Survive a lost key.** There is no recovery, no hint, no backdoor.

### Extra requirement

Encrypted bundles need **`crypto.subtle`, which exists only in a secure context**: `https://`, `http://localhost`, or `file://`. Plain `http://` on a bare LAN IP will not have it, and the bundle shows an explanatory error rather than a blank page. Unencrypted bundles have no such restriction.

Verified: `file://` reports `isSecureContext=true` and unlocks normally.

---

## GitHub Action

This repo is also a composite GitHub Action: one step, run from a workflow in
*your* repo, that bundles a directory, encrypts it, and pushes the result to
another repo — typically a public one, so a private source repo can ship a
shareable encrypted build without ever making the source public.

```yaml
name: Publish encrypted build
on:
  push:
    branches: [main]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: leonardo-faria/page-encryptor@v1
        with:
          path: ./public                            # what to bundle
          target-repo: your-org/your-public-demo     # where it goes
          target-token: ${{ secrets.PUBLISH_TOKEN }} # see below
          enable-pages: 'true'
```

That's the whole job. Every run re-bundles `path`, re-encrypts with a fresh
random key, and pushes `index.html` to `target-repo`'s default branch — creating
the repo first if it doesn't exist yet.

### Inputs

| Input | Default | Meaning |
|---|---|---|
| `path` | `.` | Directory to bundle, relative to your checked-out repo |
| `entry` | shallowest `index.html` | Entry file, relative to `path` |
| `title` | the directory name | `<title>` of the bundle |
| `exclude` | `.github` | Extra paths to skip, one per line, added to the tool's own defaults |
| `target-repo` | *(required)* | `owner/name` to publish to |
| `target-token` | *(required)* | PAT with push access — see [below](#the-token) |
| `target-branch` | `main` | Branch to publish to |
| `target-path` | `index.html` | Path within `target-repo` to write the bundle to |
| `commit-message` | `Update encrypted bundle` | Commit message on `target-repo` |
| `create-if-missing` | `true` | Create `target-repo` if it doesn't exist |
| `visibility` | `public` | Used only when creating `target-repo` |
| `enable-pages` | `false` | Turn on GitHub Pages for `target-repo`, serving `target-branch` from the directory holding `target-path` |
| `checkout` | `true` | Set `false` if an earlier step in your job already checked out your repo |

Full list, including `ref` and `node-version`, is in [`action.yml`](action.yml).

**Outputs:** `key` (masked in logs — also on the job summary of *this* run),
`target-url`, and `pages-url` (when `enable-pages` is true).

### The token

`target-token` cannot be the default `GITHUB_TOKEN` — that token is scoped to
the repo the workflow runs in and cannot write to a different one, which is
the entire point of this action. Create a PAT and add it as a secret in
*your* (private) repo's settings, then reference it as `${{ secrets.PUBLISH_TOKEN }}`.

Fine-grained PAT, scoped to the target account:

- **Contents:** read and write — always required.
- **Administration:** read and write — only if `create-if-missing` might
  actually need to create the repo, or `enable-pages` is `true`.

A classic PAT with the `repo` scope covers both and is the simpler choice if
you don't mind the broader grant.

### How the key is handled

The key is generated fresh on every run and never written to `target-repo` —
only to *this* run's job summary and step output, both scoped to whoever can
see your private repo's Actions tab. From there it's yours to move: paste it
into the job that triggered the run, forward it through a notification step,
drop it in a password manager. The action does not send it anywhere on its
own.

There is no way to recover a key after the run's summary and output are gone
(90 days by default, or your workflow's log retention setting) other than
re-running the job, which produces a *different* key — the old bundle stays
encrypted with the old one forever. If you need the same key across runs,
capture it out of the run and pass it back in yourself; this action always
generates a new one and has no `--key`-equivalent input to pin it.

### What this does not do

It does not touch history on `target-repo` beyond one commit per run, does
not delete anything, and — if `target-branch` doesn't exist yet on an
already-existing `target-repo` — creates it as an orphan branch rather than
touching any other branch. It republishes idempotently: a run against
unchanged source produces a byte-identical bundle's worth of content and
skips the commit.

It does not make repeated runs deterministic in one respect: the encryption
key is random every time, by design (see [Encryption](#encryption) for why a
random key beats a passphrase here). Two runs against identical source
produce different ciphertext and different keys.

---

## Verifying a bundle

**A bundle that renders correctly may still be broken.** An early version of this tool appeared to pass on a map app — the map drew, the list filled with 13,309 rows. It was fetching `data/stops.json` **from the web server**, because `loader.html` happened to sit next to the real `data/` folder. Moving the file anywhere else would have produced an empty app.

Check it properly:

```bash
# 1. Copy ONLY the bundle to an empty directory
mkdir -p /tmp/isolated && cd /tmp/isolated
rm -rf ./* && cp /path/to/loader.html .

# 2. Serve that directory
python -m http.server 9100
```

Then open `http://localhost:9100/loader.html` and confirm in DevTools:

- **Network tab:** the only same-origin request is `loader.html` itself. Every asset shows as `blob:`. Any `404` for a project path means that reference was not intercepted.
- **Console:** no errors.
- **The app:** actually populated, not just an empty shell.

If it works in an empty directory, it is genuinely self-contained.

---

## Shortcomings

Real limits of this strategy. Check them before promising a project will bundle.

### Cannot be fixed within a single file

| Limitation | Detail |
|---|---|
| **No Service Worker** | A Service Worker would intercept *every* request natively and remove the need for the shim entirely. It cannot be used: a SW script must be served same-origin with a JavaScript MIME type, and a `blob:` URL is rejected (`The URL protocol … is not supported`). Serving it as a second file would defeat the single-file goal. **The shim exists precisely because this door is closed.** |
| **Whole payload loads at once** | No streaming, no lazy loading. The browser parses the entire base64 string before anything runs. Past ~20 MB output this is slow, and mobile browsers may run out of memory. The script warns above that threshold. |
| **33% base64 inflation** | Applied to compressed bytes, so usually cheap — but incompressible assets (JPEG, MP4, WOFF2) get no compression and pay the full 33%. A 10 MB video becomes 13.3 MB of text. Use `-x` and host large media externally. |
| **No server-side anything** | Static assets only. No APIs, no databases, no SSR, no server-evaluated templates (PHP, ERB, Jinja). |
| **Not private without `--encrypt`** | Base64 is encoding, not encryption — anyone can extract every file from a plain bundle. `--encrypt` fixes this for delivery, but not against the key holder; see [Encryption](#encryption). Either way, never bundle secrets or `.env` files. `.env` is excluded by default; that is convenience, not security. |

### Fixable, currently unhandled

| Limitation | Detail |
|---|---|
| **Web Workers** | `new Worker('worker.js')` is not patched. The worker loads from a blob but runs with no shim, so its own `fetch`/`importScripts` calls miss the bundle. |
| **Circular ES imports** | The depth-first linker detects cycles and warns, but the modules in the cycle may still fail. Acyclic graphs — nearly all real ones — are fine. |
| **Dynamic `import()` with a computed specifier** | `import('./' + name + '.js')` is invisible to a build-time regex. Static string specifiers are handled. |
| **Import maps** | Not merged or rewritten. Bare specifiers fall through to the network. |
| **Regex-based rewriting** | HTML/CSS/JS references are matched with regexes, not parsed. Unusual constructs — an attribute-like string inside a comment, exotic quoting — may be missed or wrongly rewritten. In practice, only references that resolve to a real bundled file are ever rewritten, which makes false positives rare and harmless. |
| **CSP** | A host page with a strict `Content-Security-Policy` may block `blob:` URLs or the inline runtime script. |
| **Cross-origin iframe** | If the app is nested such that the shim cannot reach `parent.__SFB__`, it silently leaves the page unpatched. |

### Environment notes

- **`file://` works** for both test projects, including runtime `fetch()` — `about:blank` inherits the parent origin even there. It is not guaranteed for every browser or every app; `http://localhost` remains the reliable way to test.
- **Requires `DecompressionStream`**: Chrome/Edge 80+, Safari 16.4+, Firefox 113+. Older browsers get an explicit error message rather than a blank page.
- **`--encrypt` additionally requires a secure context** for `crypto.subtle` — `https://`, `http://localhost` or `file://`, but not plain `http://` on a LAN IP.

### When to use something else

- Project is already a bundler build (Vite/webpack) → configure `vite-plugin-singlefile` or `html-inline-script-webpack-plugin`; they operate on the module graph and produce cleaner output.
- You only need to inline a page's assets and control the source → rewrite it to use `data:` URIs directly.
- You need a faithful capture of a *live, deployed* page → [Monolith](https://github.com/y2z/monolith) or [SingleFile](https://github.com/gildas-lormeau/SingleFile). Note that Monolith does not execute JavaScript, so assets referenced only from JS are missed unless you pre-render with headless Chromium first.

---

## Repository layout

```
page-encryptor/
├── generate-loader.js   the bundler — the whole tool, zero dependencies
├── action.yml           composite GitHub Action wrapping the two scripts below
├── scripts/
│   ├── bundle.sh         runs generate-loader.js, surfaces the key safely
│   └── publish.sh        pushes the bundle to another repo, via `gh`
├── README.md            this file
├── .gitignore           ignores generated bundles and key files
└── docs/
    ├── index.html       the live demo — an encrypted bundle, served by
    │                    GitHub Pages from this folder
    └── .nojekyll        serve it verbatim, without Jekyll reprocessing
```

`docs/index.html` is build output, not source. It was produced by running this
bundler against a small demo site; that site's sources are not tracked here.

`action.yml` is what `uses: leonardo-faria/page-encryptor@v1` resolves to. It
does its own checkout of the calling repo, then runs `scripts/bundle.sh` and
`scripts/publish.sh` — see [GitHub Action](#github-action) for how to use it,
and [Modifying the bundler](#modifying-the-bundler) if you're changing it.

The bundler is one file with no dependencies. Copy `generate-loader.js` anywhere, or point it at a directory.

### Try it in 30 seconds

```bash
mkdir -p /tmp/demo && cd /tmp/demo
printf '<!doctype html><meta charset=utf-8><title>demo</title>\n<link rel=stylesheet href=style.css>\n<h1>hello</h1><img id=pic>\n<script src=app.js></script>' > index.html
printf 'body{font:16px system-ui;text-align:center;padding:3rem}h1{color:#3b4ce0}' > style.css
printf 'document.getElementById("pic").src="cat.svg";' > app.js
printf '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60" cy="60" r="50" fill="#f5a524"/></svg>' > cat.svg

node /path/to/generate-loader.js .
```

`loader.html` now contains all four files. The image is the interesting one: `app.js` assigns `src` at runtime, so nothing in the static markup names it — that is the case naive string-replacement bundlers miss.

---

## Modifying the bundler

- **Build-time logic** is plain Node at the top and bottom of the file: `collectFiles`, `pickEntry`, `buildContainer`, `encryptContainer`, `buildHtml`, `main`.
- **Browser-time logic** is the single function `SFB_RUNTIME`, serialized via `.toString()`. It receives everything through parameters and **must not close over anything in Node scope** — a reference to an outer variable will produce a `ReferenceError` in the browser, not a build error.
- `SFB_SHIM` is nested inside `SFB_RUNTIME` and serialized the same way for injection into the iframe. It reaches the file table through `parent.__SFB__`.
- Adding a file type: extend the `MIME` table in `SFB_RUNTIME`.
- Adding an interception point: add it to `SFB_SHIM` and record it in the shim table above.

After any change, rebuild all four checks and verify each in an empty directory:

| Check | Exercises |
|---|---|
| a gallery built with `container.innerHTML = items.map(…)` | template-rendered markup — the most commonly missed path |
| a page that calls `fetch('data/x.json')` on load | the fetch shim |
| a page with `<script type="module">` importing a sibling | depth-first specifier rewriting |
| any of the above with `--encrypt` | key form, wrong key, correct key |

**The Action wraps the CLI; it does not reimplement it.** `scripts/bundle.sh`
just builds the `node generate-loader.js …` argument list and calls it — CLI
changes (new flags, changed defaults) apply to the Action automatically with
no changes needed there. `scripts/publish.sh` is unrelated to bundling; it
only pushes an already-built file to another repo with `gh`. Changing what
gets bundled or how encryption works never requires touching either script.
