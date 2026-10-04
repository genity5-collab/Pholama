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

## Changes in 0.9.13 and 0.9.14. Please keep these

- **Studio colours** are ONE block at the end of `web/style.css` ("Studio: one readable layout for light AND dark"). It uses only theme variables (`--card`, `--fg`, `--line`...). The earlier layers with fixed greys and white text were removed because they made the light theme unreadable (white text on a near-white panel). Do not add fixed colours back. Measure contrast in BOTH themes before you push a Studio colour change.
- **The website no longer downloads models.** `mustNotDownload()` in `web/app.js` refuses every browser and CPU download when there is no PC server. Mobile support is fully ended. Chat on the site is the cloud assistant only.
- **"Connect ChatGPT" was deleted on purpose** (the card, the `/mcp` door and its switch). Bring-your-own-key for ChatGPT, Gemini and Groq (`server/providers.js`, `web/keys.js`) is a different feature and stays.
- **No "built with v0" credit line** on the website. Do not add one back.
- **Studio animation**: `web/studiofx.js` (logic and drawing), styles at the end of `web/style.css` (`.stfx-*`), wiring in `web/studio.js`. The server sends `{ toolStart }` before each Studio tool runs (4 places in `server/server.js`), and the existing `{ tool }` line after it. The last change of a run must still flash, so `fxShow` stays on through the final refresh. The tab bar is repainted often, so `restoreTabs()` puts a running pulse back. Tests: `test/studiofx.test.js`.
- **Icons**: your mascot SVG (`web/icon.svg`, identical in `docs/`) is the single source. The PNGs must be REAL sizes: `icon-192.png` 192x192 (about 6 KB), `icon-512.png` 512x512 (about 18 KB), `icon-maskable-512.png` 512x512, and `install/pholama.ico` with 16 to 256. Commit `dc6487a` put 1024x1024 pictures under the 192 and 512 names (156 KB and 663 KB), which phones ignore and which slow the first load. Export with `rsvg-convert -w SIZE web/icon.svg -o out.png`. `test/update.e2e.js` fails if `icon-192.png` is over 30 KB.
- **Update animations (0.9.15)**: `web/updatefx.js` (banner, installing scene, What's new card), styles at the end of `web/style.css` (`.updb`, `.upds`, `.updn`), wiring in `paintUpdate()` and `restartPholama()` in `web/app.js`. The card reads `releases.json`, so EVERY release needs a `title` and short `notes`. It shows once per version using `localStorage.pholama_seen_version`, never on a first install. All release text is escaped. New JS files must also be added to the offline list in `web/sw.js`. Tests: `test/updatefx.test.js`.
- **Web answers, media, My tools (0.9.21)**: `factualQuestion()` and `mediaRequest()` in `server/agent.js` make plain questions and video/picture requests search first (narrow on purpose, see `test/factual.test.js`). The server (`server/server.js`, after `routeIntent`) shows the first real YouTube link / picture link itself; pictures fall back to Wikipedia (`imageSearch` in `server/media.js`). `server/media.js` only accepts 11 character YouTube ids and https picture files. **My tools** = `server/usertools.js` (saved in `~/.pholama/usertools`, secrets in `~/.pholama/usertools-secrets.json`, never sent to the AI or the browser). Tools are named `x_<name>`, https only, private addresses blocked, redirects not followed, non-GET tools need Allow (`/api/mytools/approve`). Browser side: `web/mytools.js`. New JS files must be added to the offline list in `web/sw.js`. Groq: `GROQ_API_KEY_2` is the backup key in `functions/pholamaCloud.ts`; it must also be set where that function is deployed.
- **Settings groups + AI tool maker (0.9.22)**: Settings > Tools now has sub-groups (`.s-sub` buttons, `.s-pane[data-pane]`, `showSub()` in `web/app.js`); all old element ids are kept, so `openOpts()` still fills everything. Tools have `title` and `thumb` (`cleanThumb` in `server/usertools.js`: raster data URL up to 60 KB or https, never SVG). `POST /api/mytools/update` renames or re-describes a tool without changing its recipe. `POST /api/mytools/draft` saves the pasted API key as a secret FIRST, then asks the model for a recipe using only the secret's NAME (`sanitizeDraft` also swaps any real key the model writes out). Nothing is saved as a tool until the person presses Save. UI in `web/mytools.js`.
