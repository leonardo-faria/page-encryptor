# page-encryptor

Bundle a directory into one AES-256-GCM encrypted HTML file — as a GitHub
Action, or as a standalone CLI.

This is the GitHub Action. For the CLI it wraps, see **[CLI.md](CLI.md)**.

---

## Live demo

**→ [leonardo-faria.github.io/page-encryptor](https://leonardo-faria.github.io/page-encryptor/)**

```
key:  88RH4SXDtHpLXP81jfEbQlhCqo2XivWenkz_jxPKiFg
```

One 2 MB `.html` file — a 1.1 MB video, six photographs, a stylesheet and a
script — encrypted with AES-256-GCM. Paste the key to unlock it.

This key is published on purpose, so anyone can open the demo — see
[how the key is handled](#how-the-key-is-handled) for what that means for a
real bundle.

---

## Quick start

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
random key, and pushes `index.html` to `target-repo`'s default branch —
creating the repo first if it doesn't exist yet.

This is useful when a private repo needs to ship a shareable encrypted build
without ever making the source public.

---

## Inputs

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

---

## Encryption

AES-256-GCM, with a fresh random 256-bit key generated on every run — not a
passphrase, so there's nothing to remember and nothing worth brute-forcing
offline. The key exists nowhere but this run's own output and the ciphertext
it unlocks; lose it and the bundle is unrecoverable.

Full design rationale — why GCM, why a random key beats a passphrase here,
and exactly what this protects against (and what it doesn't) — is in
[CLI.md](CLI.md#encryption).

---

## The token

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

---

## How the key is handled

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

---

## What this does not do

It does not touch history on `target-repo` beyond one commit per run, does
not delete anything, and — if `target-branch` doesn't exist yet on an
already-existing `target-repo` — creates it as an orphan branch rather than
touching any other branch. It republishes idempotently: a run against
unchanged source produces a byte-identical bundle's worth of content and
skips the commit.

It does not make repeated runs deterministic in one respect: the encryption
key is random every time, by design (see [Encryption](#encryption) above).
Two runs against identical source produce different ciphertext and different
keys.

It also does not verify the published bundle actually works once it's live
— a bundle that renders can still be broken if something about its
environment differs from how it was tested. See
[Verifying a bundle](CLI.md#verifying-a-bundle) in the CLI reference for a
real example of this going wrong, and how to check for it.

---

## Also available as a CLI

The Action is a thin wrapper around `scripts/generate-loader.js`, a
zero-dependency Node script you can run directly — no CI required. Same
bundling, same `--encrypt`, same runtime.

```bash
node scripts/generate-loader.js ./my-site --encrypt
```

Full reference — flags, how the bundling and encryption actually work, what
this strategy can and can't do — is in **[CLI.md](CLI.md)**.

---

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the repo layout, how the
Action relates to the CLI, and things worth knowing before changing either.
