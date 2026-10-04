# Pholama

Run an AI chat **on your own phone or PC**. Free. You need a free account (name + password, no email) to chat and download.

## On your phone (3 taps)

1. **[Tap here to open Pholama](https://genity5-collab.github.io/Pholama/)** (use Chrome)
2. Tap **Models**, then tap **Download** on the first model.
3. Tap **Close** and start typing.

That is all. The first download takes a few minutes. After that it works even offline.

**Tip:** in Chrome tap the three dots, then **Add to Home screen**, to use it like an app.

### Make a free account (required)

Tap **Account**, pick a **name and a password**. No email needed, and you stay logged in on that device.
You must be logged in to send a message or download a model. Optionally turn **Memory** on, then say things like *"remember that I like short answers"*. Pholama uses what it
remembers in later chats. See or delete everything in **Account**. Memory is **off** until you turn it on.

Note: there is no email, so a forgotten password **cannot be reset**. Pick one you will remember.

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

### Agent Max (cloud, nothing to download)
Pick **Agent Max** in the model list. It can use tools, open and close the app's windows for you, check your limits, and knows how Pholama works. You get **10 messages a day and 30 a month**; the daily 10 restock every day until you hit 30, then it waits for next month. Local models are always free. [Details](docs-md/AGENT.md#agent-max)

### More for phones
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

The PC app checks GitHub a few seconds after it starts and then every 6 hours. If there is a new version it downloads it quietly, and shows **Update ready** at the top. Close Pholama and start it again to use it. The web part (the screens) changes the next time you reload the page.

- **Your models, accounts, keys, credits and settings are never touched.** They live in `~/.pholama`, outside the program folder.
- A copy of the old version is kept in `~/.pholama/previous-version` in case you want to go back.
- Turn it off in **Tools > Updates**, or press **Check now** to look right away.
- Prefer the command line? `pholama update` does the same thing.
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
