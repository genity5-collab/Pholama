# Pholama

Run an AI chat **on your own phone or PC**. Free and private.

> **Phone support has ended.** Phones do not have enough storage for good models, so Pholama is now built for the **PC app**: bigger models, tools, web search and Roblox Studio.
> The small website still works on a phone for daily chat, maths and reading pictures, and you can still use Pholama there. It just gets no new features.

## On your phone (still works, 3 taps)

1. **[Tap here to open Pholama](https://genity5-collab.github.io/Pholama/)** (use Chrome)
2. Tap **Models**, then tap **Download** on a model.
3. Tap **Close** and start typing.

The first download takes a few minutes. After that it works even offline.

**Tip:** in Chrome tap the three dots, then **Add to Home screen**, to use it like an app.

### The best pair for a phone (about 0.7 GB)

Download these two and you can chat, do maths and **send pictures**:

| | Model | Size | What it does |
|---|---|---|---|
| Reader | **SmolVLM 256M** | ~190 MB | Looks at a picture and writes down what is in it |
| Brain | **Qwen2.5 0.5B** | ~0.5 GB | Chats, helps, does maths, answers about the picture |

How it works: the reader looks at your picture, then the brain answers using what the reader saw. Everything runs on your phone. Nothing is uploaded.
Full guide: [Send files and pictures](docs-md/FILES.md).

### Pholama Platform (the website)

The website is now **Pholama Platform**. The AI lives in the PC app, and the site is where you log in, keep a profile and meet other people.

- **Logged in as** your own Platform name, in the header on PC and phone. You choose the name and picture, and they are not your Discord or GitHub name or email.
- **Communities** with posts. **Every post disappears after 3 hours.** React with Like, Love, Haha, Wow or Fire.
- **Moderation:** report a post. Three reports hide it until a moderator looks. Links and secret keys are blocked in posts, and the database enforces this, not the page.
- **Your last local AIs:** when the PC app opens, it sends only the **names** of your downloaded models, once, when your PC is idle. No files and no chats.
- **One small assistant on the site.** It can chat, and it cannot use tools or files. Bigger models and tools are in the PC app.

**Sign in with GitHub:** press **Continue with GitHub** in Settings > Account, on the site or the PC app. It replaces pasting a token, and every write to GitHub still asks you first. Use the **same GitHub account on both** and the PC app adds **250 credits**, once per account.

**Setup for whoever runs Supabase (once):** turn on the GitHub provider, then run [`supabase/github_bonus.sql`](supabase/github_bonus.sql) and [`supabase/platform.sql`](supabase/platform.sql) in the SQL Editor. GitHub callback URL: `https://<project>.supabase.co/auth/v1/callback`. Add the site and `http://localhost:11435/` to Supabase redirect URLs. To make someone a moderator: `insert into public.pholama_moderators (user_id) values ('<their user id>');`


### Moderator guide

**1. Run the SQL once, in this order** (Supabase > SQL Editor > New query > paste > Run): `supabase/github_bonus.sql`, then `supabase/platform.sql`, then `supabase/platform2.sql`.

**2. Find your user id.** Log in to the site once and pick a Platform name. Then in the SQL Editor run `select user_id, platform_name from public.pholama_profiles;` (or open Supabase > Authentication > Users and copy the UID column).

**3. Make someone a moderator:** `insert into public.pholama_moderators (user_id) values ('PASTE-THE-ID-HERE');` Remove one with `delete from public.pholama_moderators where user_id = 'PASTE-THE-ID-HERE';` Log out and in again to see the **Moderator** tab.

**4. Moderate.** On any post you get Hide, Edit, Remove, Warn, Ban and Copy user id. The **Moderator** tab has a command line, and the same commands work in the SQL editor as `select public.pholama_mod_cmd('...');`

| Command | What it does |
|---|---|
| `whois <name or id>` | Shows the user id, warnings and ban |
| `warn <name> <reason>` | Sends a warning they see on Home |
| `ban <name> <hours or perm> <reason>` | Bans for a set time, or forever |
| `unban <name>` | Lifts a ban |
| `takedown <post id>` / `restore <post id>` | Hides or brings back a post |
| `delete <post id>` | Removes a post for good |
| `edit <post id> <new text>` | Edits a post (marked as edited by a moderator) |
| `project hide <id>` / `project show <id>` | Hides or shows a project |
| `daily <title> \| <text>` | Sets today's daily post |

Moderators cannot ban themselves or other moderators. Every action is saved in the audit log, which only moderators can read. The database checks that you are a moderator on every command, so a changed web page cannot give anyone these powers.

### Memory limits

Pholama can remember facts about you ("remember that I like short answers"). To keep things light:

| Where | Memories you can keep |
|---|---|
| The website (phone or browser) | **5** |
| The PC app | **15** |

When it is full, Pholama tells you and shows how many are used ("5 of 5 memories used"). Open **Settings > Account** and press **Forget** on one to make room.

### Duo: two local AIs working together

Open **Models** and you will see a **Duo** switch at the top. It is **off by default and you can switch it off any time**.

With Duo on, a small second AI (the *helper*) writes quick hints, then your chosen AI (the *main* AI) writes the answer. You pick the helper from the models you have downloaded.

- **What it is good for:** making the thinking step faster. In our test it was about 25% quicker per thinking message.
- **What it is not:** it does **not** make answers smarter. On 20 test questions the single 1.5B model got 17 right and the duo got 16. Small helpers can be wrong, so the main AI is told the hints may be wrong.
- **Safe by design:** the helper must be clearly smaller (at most 60% of the main model). It is never the same model. If memory is low, there is no second model, or the helper fails, Pholama quietly uses one AI and tells you why.
- **PC app:** the helper runs as its own engine. It is stopped when you close Pholama, when the lag guard fires, and when you turn Duo off.
- **Website:** the helper runs in the browser (CPU). It needs enough device memory to hold two models.

### Downloads keep their place

Stop a download any time. **Resume** continues from where it stopped, even after you close the app
(on the PC it survives a restart too). **Delete** frees the space.

### Something not working?

| What you see | Tap this |
|---|---|
| "No usable WebGPU" | Normal on many phones. Pick a model with **(CPU)** in the name. [What is CPU mode?](docs-md/MODELS.md#on-a-phone-without-a-gpu-slower) |
| Download stops or errors | Tap **Retry** or **Resume**. It continues from the files already saved. Use WiFi. Free up some storage. |
| Too slow | [Pick a smaller model](docs-md/MODELS.md) |
| iPhone | Needs iOS 18 or newer, in Safari. Small models only. |

### More for phones
- [Send files and pictures](docs-md/FILES.md)
- [Which model should I pick?](docs-md/MODELS.md) (every model, what it is good at, what phone it fits)
- [Use your PC's power from your phone](docs-md/PC.md#chat-from-your-phone-over-wifi)

## On your PC (more power, tools, web search)

The PC version can also search the web, use tools and show a **live log** of what the AI is doing.

**You do not need to install Node.js.** The installer (option A) brings its own private copy, about 30 MB, and installs nothing on your PC.

**A. Installer (recommended: saves Pholama in a `Pholama` folder in your home folder, then starts it)**

Windows (PowerShell):
```
irm https://raw.githubusercontent.com/genity5-collab/Pholama/main/install/install.ps1 | iex
```
Mac / Linux (Terminal):
```
curl -fsSL https://raw.githubusercontent.com/genity5-collab/Pholama/main/install/install.sh | bash
```

**B. Zip file:** [download](https://github.com/genity5-collab/Pholama/archive/refs/heads/main.zip), unzip, then double-click **start.bat** (Windows) or run `./start.sh` (Mac/Linux). This route needs [Node.js 18+](https://nodejs.org) already installed; the installer above does not.

**C. One command with npx** (only if you already have [Node.js 18+](https://nodejs.org))
```
npx github:genity5-collab/Pholama
```

**Look for the llama icon.** The installer (A) puts a **Pholama** icon on your Desktop and in the Start Menu (Windows), in your app launcher (Linux) or on your Desktop (Mac). Double-click it to open Pholama. If you used the zip (C), the first time you run **start.bat** it adds the icon to your Desktop too.

Then open **http://localhost:11435**, tap **Models**, then **Install**, then **Download** a model.

### How big is the PC version?

| Part | Size | Notes |
|---|---|---|
| **Pholama itself** | **about 0.5 MB** | The program and screens. No extra packages to install. |
| **AI engine (llama.cpp)** | **11 to 18 MB** | Downloaded once from **Models > Install**. Windows CPU 18 MB, Mac 11 MB, Linux 17 MB. |
| **AI engine with NVIDIA GPU (Windows)** | **about 250 MB** | Faster on NVIDIA graphics cards. Chosen automatically if one is found. |
| **Each AI model** | **0.13 GB to 13.4 GB** | You only download the ones you pick. |

Model sizes by what your PC has:

| Your PC's memory (RAM) | Models that fit | Download size each |
|---|---|---|
| 2 to 4 GB | SmolLM2, Qwen2.5 0.5B/1.5B, Gemma 3 1B, Llama 3.2 1B | 0.1 to 1.9 GB |
| 5 to 8 GB | Gemma 3 4B, Phi-4 Mini, Qwen2.5 3B/7B, Llama 3.1 8B | 2 to 5 GB |
| 9 to 16 GB | Gemma 2 9B, Gemma 3 12B, Qwen2.5 14B, Phi-4 14B, GPT-OSS 20B | 5 to 11 GB |
| 17 GB and up | DeepSeek-R1 32B, Qwen2.5-Coder 32B, Mistral Small 24B | 11 to 13.4 GB |

**A good start:** Pholama + engine + one small model is roughly **1 to 3 GB** in total. Each model you add is a separate file, so free space is the only limit. All 51 models together would be about 200 GB, so nobody needs to download them all.

Models are saved in one folder, so you can delete any you stop using (`pholama rm <model>`) to get the space back.

**Recommended model:** `pholama pull llama3.2-3b` (about 1.9 GB, needs 4 GB RAM). It is the smallest model that **really** runs tools. If you have 8 GB or more, `qwen2.5-7b` or `qwen3-8b` is much better.

**Which models can run tools?** Every model in the list has a label:
- **Runs tools** (16 models, 3B and bigger, for example Qwen2.5 7B, Qwen3 8B, Llama 3.1 8B, Hermes 3): trained to call tools and big enough to do it well. These get the full agent.
- **Basic tools only** (Qwen2.5 1.5B, Qwen3 0.6B): too small to act as an agent. Pholama guides them, so Studio builds and edits still work, but they are not a real agent.
- **Chat only** (the rest): fine for talking, not for tools. Pholama never recommends them for agent work.

**Keeps your PC smooth:** while a local AI runs, Pholama watches the PC. If it really starts to lag (memory almost full, or the PC freezing up; a busy CPU alone never stops it, because a model writing a reply is meant to use the CPU) it stops all local AIs and tells you why. Only local AIs are stopped. When you close Pholama, every local AI is stopped too.

**Remove Pholama completely:** `pholama remove-all` deletes the app, every downloaded model, the private Node.js, the `pholama` command and the icons. It lists everything first and waits for you to type `remove`. Use `pholama remove-all --dry-run` to only see the list. Updates only replace the 0.5 MB program, never your models.

To reach your PC from your phone or away from home, see "Use your PC's AI from anywhere" in [docs-md/AGENT.md](docs-md/AGENT.md).

Then read:
- [Full PC guide](docs-md/PC.md)
- [Tools, search, credits, switches, tokens, live log](docs-md/AGENT.md)
- [All models](docs-md/MODELS.md)
- [Use your local AI in a game or website](docs-md/API.md)

## The dashboard

Pholama opens on a **Dashboard**: the newest version, what's new, the newest models, how many models run tools, and (on the PC app) your memory, graphics card and the best tool model that fits your PC. Tap **Chat** at the top to talk to the AI. The website and the PC app show the same dashboard.

## Releasing an update (for the maker)

The website (`docs/`, used on phones) and the PC app (`web/`) must always show the same newest models and version. Follow this every time:

1. Add or change models in `models.pc.json`. Give each one a `toolTier` (`good`, `basic` or `none`), an `added` date, and a `released` month (`YYYY-MM`) if you know it. A model with no `released` month is simply never listed as "new".
2. Add a new entry at the **top** of `releases.json` (version, date, title, notes) and set `latest`.
3. Set the same version in `package.json`.
4. Run `npm run sync-site`. It copies the full model list and version history into both `docs/` and `web/`.
5. Run `npm test`. It fails if the website or the PC app is out of date, so a release cannot go out with an old list.
6. Phone models (the in-browser list) live in `docs/models.json` under `browser` and `cpu`. Update those by hand when a browser model is added.

The PC updater reads `package.json` from the default branch and downloads that branch's archive; a GitHub Release or tag by itself does not publish an update to the app.

## Add your own tools for the AI to run (PC only)

The AI can only use tools on the **PC version**, with a model labelled **Runs tools**. All tools are free. Out of the box it already has 19.

### Built-in tools (no setup)
| Tool | What it does |
|---|---|
| `web_search`, `fetch_page` | Search the web and read a page |
| `calculator`, `current_time`, `convert_units` | Exact maths, the date, unit conversion |
| `list_files`, `read_file`, `search_files` | Look around your **workspace folder** |
| `write_file`, `append_file`, `edit_file`, `make_folder`, `delete_file` | Create and change files in the workspace |
| `json_tool`, `text_stats`, `hash_text`, `random_number`, `system_info` | Small helpers |
| `run_command` | Needs the Terminal switch and your **Allow** click |

File tools can only touch one folder: `~/.pholama/workspace` (on Windows `C:\Users\you\.pholama\workspace`). They cannot read or change anything outside it, and they refuse `.exe`, `.bat` and other program files. Every change is written to the edit log.

There are three ways to give it more.

### 1. Let it run programs on your PC (any platform)
Open **Tools** and turn on **Terminal**. The AI can then suggest one command at a time. Nothing runs until you press **Allow**. Commands work the same on Windows, Mac and Linux, so install the program you want once and the AI can call it:

| You want the AI to use | Install it once | Then ask |
|---|---|---|
| Python scripts | [python.org](https://python.org) | "Run my script in C:\\Users\\me\\tools\\clean.py" |
| Git | [git-scm.com](https://git-scm.com) | "Show the last 5 commits in this folder" |
| Node tools | [nodejs.org](https://nodejs.org) | "Run npm test in my project" |
| Your own script | save it anywhere | "Run backup.bat" (Windows) or "Run ./backup.sh" (Mac/Linux) |

Each command stops by itself after 60 seconds, output is capped, and dangerous commands (wipe, format, shutdown, admin rights) are blocked. Press **Stop** to end one early. Every command is listed in **Tools > Edit log**.

### 2. Add an MCP server (the "plugin" way)
MCP servers give the AI ready-made tools (files, databases, calendars, your own apps). Pholama supports **HTTP(S) MCP servers**.

1. Start or find an MCP server that has a web address, for example `http://localhost:3000/mcp`.
2. Open **Tools > MCP tools**, give it a name, paste the address, and add a header only if the server needs a key.
3. Pick a model tagged **tools**. The AI sees the server's tools on the next message and uses them when they help.

Or add one from the command line of the running app:
```
curl -X POST http://localhost:11435/api/mcp -H "Content-Type: application/json" ^
  -d "{\"name\":\"mytools\",\"url\":\"http://localhost:3000/mcp\"}"
```
(On Mac/Linux use `\` instead of `^` at the end of the line.) Remove it with `DELETE /api/mcp?name=mytools`. Servers that only run as a local program (stdio) are not supported yet. Put a small HTTP wrapper in front of them, or use route 1.

### 3. Build a tool yourself (developers)
Write a tiny MCP server in any language that answers `tools/list` and `tools/call` over HTTP, then add it as in route 2. Or edit `server/agent.js` and add an entry to `BUILTIN` with a `desc`, a `run` function and a `kind`. Built-in tools need an update-safe copy: `pholama update` replaces program files, so keep your own tools in an MCP server instead.

### Keep it safe
- Only add servers you trust. A tool can do whatever its server can do.
- Writing to GitHub and every command always asks you first.
- Phones and other devices that connect with a key get plain chat only. They can never run tools or commands on your PC.
- The AI's file tools are locked to the workspace folder.

## Updates without reinstalling (PC only)

The PC app checks GitHub every minute while it is open and every 5 hours while it is closed (when the PC is on and you are signed in). If a new version is found, it installs quietly and relaunches the PC server once its old port has been released. An already-open app tab reloads when the replacement version is ready. **Check now** checks and installs immediately even if automatic updates are switched off.

- **Your models, accounts, keys, credits and settings are never touched.** They live in `~/.pholama`, outside the program folder.
- A copy of the old version is kept in `~/.pholama/previous-version` in case you want to go back.
- Turn automatic updates off in **Tools > Updates**; **Check now** is still a one-time install action.
- If upgrading from an older build that reports a connection error while restarting, close Pholama, run `pholama update` in a terminal, then open it again. The command replaces program files but does not restart the running server.
- Prefer the command line? `pholama update` checks and downloads the current default-branch version.
- Nothing updates if GitHub cannot be reached. Your current version keeps working.

## For developers

- [`web/`](web) the chat page (shared by phone and PC)
- [`server/server.js`](server/server.js) the PC host, no dependencies
- [`server/agent.js`](server/agent.js) credits, tools, MCP, agent loop, memory tool
- [`web/account.js`](web/account.js) name + password accounts and memory (Supabase, row-level security)
- [`web/loader.js`](web/loader.js) the llama download loader
- [`models.json`](models.json) the model list
- Ollama and OpenAI compatible API for games and sites: see [docs-md/API.md](docs-md/API.md) (or open `http://localhost:11435/api/docs` while Pholama runs)
- [`server/tools2.js`](server/tools2.js) the workspace file tools and helpers
- [`web/dashboard.js`](web/dashboard.js) the dashboard (a copy lives in `docs/`), [`scripts/sync-site.js`](scripts/sync-site.js) keeps the website and PC app in step
