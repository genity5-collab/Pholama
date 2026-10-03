# Pholama

Run an AI chat **on your own phone or PC**. Free. An account is optional (only for memory).

## On your phone (3 taps)

1. **[Tap here to open Pholama](https://genity5-collab.github.io/Pholama/)** (use Chrome)
2. Tap **Models**, then tap **Download** on the first model.
3. Tap **Close** and start typing.

That is all. The first download takes a few minutes. After that it works even offline.

**Tip:** in Chrome tap the three dots, then **Add to Home screen**, to use it like an app.

### Optional: make a free account for memory

Tap **Account**, pick a **name and a password**. No email needed, and you stay logged in on that device.
Turn **Memory** on, then say things like *"remember that I like short answers"*. Pholama uses what it
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

### More for phones
- [Which model should I pick?](docs-md/MODELS.md) (every model, what it is good at, what phone it fits)
- [Use your PC's power from your phone](docs-md/PC.md#chat-from-your-phone-over-wifi)

## On your PC (more power, tools, web search)

The PC version can also search the web, use tools and show a **live log** of what the AI is doing.

1. [Install Node.js](https://nodejs.org) (click the big green button).
2. [Download Pholama](https://github.com/genity5-collab/Pholama/archive/refs/heads/main.zip) and unzip it.
3. Double-click **start.bat** (Windows) or run `./start.sh` (Mac/Linux).
4. Open **http://localhost:11435**, tap **Models**, then **Install**, then **Download** a model.

Then read:
- [Full PC guide](docs-md/PC.md)
- [Tools, search, credits, switches, tokens, live log](docs-md/AGENT.md)
- [All models](docs-md/MODELS.md)

## For developers

- [`web/`](web) the chat page (shared by phone and PC)
- [`server/server.js`](server/server.js) the PC host, no dependencies
- [`server/agent.js`](server/agent.js) credits, tools, MCP, agent loop, memory tool
- [`web/account.js`](web/account.js) name + password accounts and memory (Supabase, row-level security)
- [`web/loader.js`](web/loader.js) the llama download loader
- [`models.json`](models.json) the model list
- Ollama-compatible API: see [the PC guide](docs-md/PC.md#api-ollama-compatible)
