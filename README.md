<div align="center">

# KeysArk

**Open-source, free, end-to-end encrypted vault for your passwords, keys, and secret text — stored in your own cloud drive.**

Your secrets are encrypted in your browser with a key derived from a **BIP39 recovery phrase**. Only ciphertext ever leaves your device. The server and your cloud drive never see your plaintext, your phrase, or your master key.

[Website](https://keysark.com) · [CLI (`ark`)](#cli-ark) · [Self-hosting](#self-hosting) · [Security model](#security-model)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![End-to-end encrypted](https://img.shields.io/badge/encryption-AES--256--GCM-success.svg)](#security-model)
[![BIP39](https://img.shields.io/badge/keys-BIP39%20mnemonic-orange.svg)](#how-it-works)

</div>

---

## What is KeysArk?

KeysArk is a **zero-knowledge password and secret-key manager**. Instead of trusting a vendor's database with your secrets, KeysArk encrypts everything **in your browser** and stores the resulting ciphertext in **a cloud drive you already own** — Google Drive or Baidu netdisk. We never run a secret store; we only move opaque ciphertext between your browser and your drive.

- 🔓 **Open source & free** — no accounts to buy, no subscription, no premium tier. Use the hosted app or run your own.
- 🔑 **Your recovery phrase is your master key** — a standard 24-word BIP39 mnemonic derives the encryption key. Nothing to download, no key files to babysit. Importable into MetaMask and other BIP39 wallets.
- ☁️ **Stored in your own cloud drive** — ciphertext lands in *your* Google Drive / Baidu netdisk, using free space you already have. We never touch your storage and never charge you.
- 🧰 **GitHub-friendly backup workflow** — back up the secret files your repos need (`.env`, keys, tokens) and pull them back by their GitHub path with the `ark` CLI.
- 🏠 **Self-hostable** — the whole stack is in this repo. Clone it, point it at your own OAuth apps and database, and host it yourself.

## Why KeysArk

| | Typical password manager | KeysArk |
|---|---|---|
| Where secrets live | Vendor's servers | **Your** Google Drive / Baidu netdisk |
| Who can decrypt | Vendor holds the keys (in principle) | **Only you** — key never leaves your browser |
| Account required | Yes | No — a recovery phrase *is* your identity |
| Cost | Often a subscription | **Free & open source** |
| Self-host | Rarely | **Yes** |
| A server breach reveals | Potentially everything | **Nothing** — only ciphertext is stored |

## How it works

```
┌─────────────────────── your browser ───────────────────────┐
│                                                             │
│   1. BIP39 recovery phrase   ──derive──▶  AES-256 key       │
│                                                │            │
│   2. plaintext  ──AES-256-GCM encrypt──▶  ciphertext        │
│                                                │            │
└────────────────────────────────────────────────┼───────────┘
                                                  │  only ciphertext
                                                  ▼
                            ┌───────────────────────────────────┐
                            │  your cloud drive (Google / Baidu) │
                            └───────────────────────────────────┘
```

1. **Write down your phrase.** Generate a new 24-word BIP39 mnemonic (or import an existing one). It is shown once and stays with you — it is your master key.
2. **Derive the key locally.** The phrase is turned into an AES-256 key right in the browser (BIP39 seed → HKDF-SHA256).
3. **Encrypt in the browser.** Plaintext is sealed with AES-256-GCM (random 96-bit IV every time) before anything leaves the device.
4. **Store ciphertext in your drive.** The server and the storage backend only ever handle opaque base64 ciphertext.

## Storage backends

KeysArk talks to one storage backend at a time via a single abstraction; the app code is backend-agnostic.

- **Google Drive** — OAuth login. Location is chosen by the `GOOGLE_DRIVE_FOLDER` env var:
  - *empty (default)* → **appDataFolder**: a hidden, app-private folder (`drive.appdata` scope) you won't even see in Drive.
  - *a folder name (e.g. `KeysArk`)* → a **visible folder** in *My Drive* (`drive.file` scope — the app can only touch files it created).
- **Baidu netdisk** — OAuth login, sandboxed under `/apps/Keyper/`.

Switching the Google folder setting changes the OAuth scope, so it requires re-authorizing.

## CLI (`ark`)

A companion command-line client lets you read and write vault items from your terminal — ideal for pulling `.env` files and secrets into projects and CI.

```bash
npm install -g @keysark/cli

ark login                 # device-code login via the browser
ark import                # import your recovery phrase, set an unlock password
ark get github.com/me/app/.env .env   # decrypt a secret to a local file
ark save .env             # encrypt & upload a file (target auto-detected from git origin)
```

The CLI mirrors the web app's security model: your mnemonic is stored locally, wrapped with an unlock password using **Argon2id** (512 MB / t=4 / p=1). Plaintext and the master key never leave your machine, and `KEYSARK_MNEMONIC` lets scripts/CI run non-interactively. Run `ark help` for the full command list (`login`, `logout`, `status`, `info`, `import`, `forget`, `vaults`, `ls`, `get`, `new`, `set`, `save`, `rm`, `sync`, `local`).

### Git-native batch sync (`.keysark`)

For projects, declare the secret files a repo needs in a **`.keysark`** manifest at the repo root — one repo-relative path per line. It lists *paths only, no secrets*, so it's safe to commit:

```
# .keysark
.env
.env.production
config/app.secret.json
```

Then sync the whole project with no per-file arguments:

```bash
ark save .keysark   # store the manifest in the vault (once)

ark save            # encrypt & upload every file listed in .keysark
ark get             # pull them all back (e.g. on a fresh clone)
```

Run inside a git repo, the target path is derived from your git origin (`github.com/owner/repo/<path>`), so individual files are terse too — `ark get github.com/owner/repo/.env` restores `.env` to its place, no second argument needed (pipes/redirects still stream to stdout). `ark save` skips unchanged files; `ark get` won't overwrite local files that differ unless you pass `--force`.

### Offline / local decryption

```bash
ark local ./keysark-backup.zip   # decrypt a backup downloaded from your netdisk
```

Point `ark local` at a `.zip` of your KeysArk folder (or its extracted directory). It prompts for the vault's recovery phrase, then writes one JSON per item plus a self-contained `index.html`. Nothing is uploaded — everything stays on your machine.

## Security model

- **End-to-end encryption.** Encryption and decryption happen **only in the browser**, only in `@keysark/crypto`. The master key (derived from the mnemonic), the mnemonic itself, and any plaintext are forbidden from appearing in any server code, API request/response, URL, cookie, log, or database.
- **The server is a dumb pipe.** APIs move only opaque base64 ciphertext; `@keysark/baidupan` and `@keysark/googledrive` are bytes-in / bytes-out and content-agnostic.
- **Keys.** BIP39 — **24 words, English wordlist** (256-bit entropy, standard BIP39, importable into MetaMask) for newly created vaults. Legacy 12-word phrases are still accepted. AES-256-GCM with a fresh random 96-bit IV per encryption; IVs are never reused.
- **Local unlock.** The CLI and web app wrap your mnemonic with an unlock password using **Argon2id (512 MB / t=4 / p=1)**. Parameters are stored alongside the credential; raising them only affects newly wrapped secrets.
- **Auditable backups.** Exported mnemonic backups (PDF/HTML) record the exact source commit, build environment, and crypto dependency versions, so anyone can check out the precise code that produced a backup and verify the encryption.

> KeysArk is built so that a full compromise of our servers or your cloud provider reveals **nothing but ciphertext**. The trade-off is the usual one for true E2E: **if you lose your recovery phrase, no one — including us — can recover your data.**

## Repository layout

A pnpm monorepo (`apps/*`, `packages/*`):

| Package | What it is |
|---|---|
| `apps/web` | Next.js app — OAuth login, unified byte-file API, browser-side encrypt/decrypt vault UI. |
| `apps/cli` | The `ark` command-line client. |
| `packages/crypto` | Browser-only E2E crypto (BIP39 mnemonic → AES-256-GCM). |
| `packages/vault` | Vault domain logic shared by web and CLI. |
| `packages/baidupan` | Baidu netdisk client (OAuth + sandboxed file I/O, bytes in/out). |
| `packages/googledrive` | Google Drive client (OAuth + appDataFolder / visible-folder I/O). |
| `packages/db` | Drizzle ORM + postgres-js. Stores only OAuth tokens, keyed by `(provider, account_key)`. |
| `packages/ui` | React + Tailwind + shadcn/ui wrapper layer. |

## Self-hosting

Everything you need to run KeysArk yourself is in this repository.

### Prerequisites

- Node.js + [pnpm](https://pnpm.io/)
- A PostgreSQL database (stores only OAuth tokens — never your secrets)
- OAuth credentials for at least one backend:
  - **Google Drive** — a Google Cloud OAuth client
  - **Baidu netdisk** — a Baidu Open Platform app (sandbox `/apps/Keyper/`)

### Quick start

```bash
pnpm install

# configure environment (see apps/web/.env for the full list)
#   DATABASE_URL=postgres://...
#   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
#   GOOGLE_DRIVE_FOLDER=          # empty = hidden appDataFolder; or e.g. "KeysArk"
#   BAIDU_APP_KEY / BAIDU_SECRET_KEY   # optional, if using Baidu
#   NEXT_PUBLIC_SITE_URL=https://your.domain
#   KEYSARK_REPO=https://github.com/your/fork   # shown as the repo button & in backups

pnpm --filter @keysark/db db:push     # apply the schema
pnpm --filter @keysark/web dev        # start Next.js on port 6134
```

Common commands:

- `pnpm -r typecheck` / `pnpm -r build`
- `pnpm --filter @keysark/web dev` — start the web app (port 6134)
- `pnpm --filter @keysark/db db:push` — apply the schema in development

## Internationalization

The web app ships in **English by default**. Other languages are served under a locale prefix in the URL (for example `/zh` for Chinese); the default locale lives at the root with no prefix. Use the language switcher in the header to move between them.

## Contributing

Issues and pull requests are welcome. KeysArk is open source — fork it, audit the crypto, run your own instance, and send improvements back.

## License

[MIT](./LICENSE) © KeysArk contributors
