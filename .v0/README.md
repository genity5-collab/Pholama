# Note for v0: how updating works in Pholama (read before editing)

This file is written for v0. It is a normal file in the repo, so anyone who can open the repository can read it. It contains no keys or tokens, and must never get any.

## There are two separate things that "update"

1. **The PC app** (`server/update.js`). It downloads the newest `main` branch from GitHub, replaces the program files, and keeps user data in `~/.pholama`. It decides "newer" ONLY by comparing `version` in `package.json`.
   - **If you change the app, you must raise `version` in `package.json`.** Also raise `latest` and add an entry in `releases.json`, then run `node scripts/sync-site.js`. Without a higher version number, nobody's PC will ever install your change.
   - The update only counts as valid if the download contains `server/server.js` and a valid `models.pc.json`. Never delete or rename those.
2. **The website and the browser copy** (`web/` for the PC app, `docs/` for the public site). The browser keeps its own cache, which is why "it updated but I still see the old version" happens.

## Why Studio and icons looked stuck (fixed in 0.9.12). Please do not undo this

- `server/server.js` (the "static" block near the end) now sends `Cache-Control: no-cache` and an `ETag` on every page file, and answers `304` when nothing changed. Before, there was no header and the browser guessed, so it kept the old `studio.js`, CSS and icons. Keep those headers.
- The service worker (`web/sw.js`, `docs/sw.js`) is only used on the public website. **The PC app deliberately does not register it** (`!server` check in `web/app.js`).
- The service worker's file list `F` must contain only files that exist in that same folder, because one missing file makes the whole install fail and the old version stays. `web/` and `docs/` have different lists on purpose. **Raise the cache name (`pholama-vNN`) every time you change any cached file**, otherwise visitors keep the old copy.
- Studio has a "Refresh files" button. It only re-reads the user's Studio PROJECT files from the local server. It does not update Pholama.

## Icons: one source, keep them small

- The logo is `web/icon.svg` (a llama in profile, white outline on a dark tile). `docs/icon.svg` must be identical.
- PNGs are made from the SVG: `icon-192.png` (about 6 KB), `icon-512.png` (about 18 KB), and `icon-maskable-512.png` (full-bleed, the llama kept inside the centre 40 percent so phones cannot crop it). `install/pholama.ico` holds 16, 24, 32, 48, 64, 128 and 256 px for Windows.
- Do not save 1024 px photos under the names `icon-192.png` or `icon-512.png`. The last attempt made them 700 KB each, and it failed to show on phones.
- `manifest.webmanifest` must list the PNGs. An SVG-only manifest with `"purpose": "any maskable"` gets cropped and sometimes refused by phones.
- To change the logo, edit the SVG, then regenerate every PNG and the `.ico` from it with `rsvg-convert -w SIZE icon.svg -o out.png`, so they can never disagree with each other.

## Before you push

1. `npm test` and `npm run test:e2e` must pass. `test/update.e2e.js` runs a fake GitHub and checks that an old copy finds, installs and serves a newer version, and that page files are sent with `no-cache` and cannot escape the web folder.
2. Run `node scripts/sync-site.js` so `docs/` matches `web/`.
3. Do not commit tokens, keys or passwords. The user's provider keys live in `~/.pholama` and never belong in the repo.
4. The sandbox rules are kept: the file tools must not read outside the active workspace.
