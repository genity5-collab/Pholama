# Pholama

Ollama-style local AI for **PCs and phones**.

- **Phones:** models download and run *inside the browser* (WebGPU). No server, no app store.
- **PCs:** a tiny local server uses your computer's RAM/GPU via llama.cpp (or your existing Ollama) and serves the chat UI.

One chat UI for both.

## Phone (browser only)

Open the hosted page (GitHub Pages) in **Chrome on Android 121+** and tap **Models** -> pick one -> **Download**.
Weights are cached in the browser, so you only download once. Use "Add to Home screen" to install it as an app.

| Model | Size | Good for |
|---|---|---|
| SmolLM2 360M | ~0.3 GB | any phone |
| Qwen2.5 0.5B | ~0.4 GB | any phone |
| Qwen2.5 1.5B / Llama 3.2 1B | ~1 GB | most phones |
| Gemma 2 2B | ~1.6 GB | 6 GB+ RAM |
| Llama 3.2 3B | ~2.3 GB | flagship phones |

iPhone: needs iOS 18+ Safari with WebGPU enabled; small models only.

## PC (local host)

Requires [Node.js 18+](https://nodejs.org). Nothing else to install.

```
git clone https://github.com/genity5-collab/Pholama
cd Pholama
node server/server.js      # or start.bat on Windows, ./start.sh on Mac/Linux
```

Open **http://localhost:11435**, then:
1. **Models -> On this PC -> Install** (downloads llama.cpp for your OS, with CUDA on NVIDIA GPUs).
2. Pick a model that fits your RAM (the list tells you) and **Download**.
3. Chat.

Already use Ollama? Just leave it running; its models show up in the picker automatically.

### Chat from your phone over WiFi

```
HOST=0.0.0.0 node server/server.js          # Windows: set HOST=0.0.0.0 && node server\server.js
```
Then open `http://<your-PC-IP>:11435` on your phone. The phone uses the PC's power.
Only do this on a network you trust: there is no login.

### API (Ollama-compatible)

`GET /api/tags`, `POST /api/chat`, `POST /api/generate` stream NDJSON like Ollama.
Plus `GET /api/hardware`, `POST /api/pull {id}`, `POST /api/install-llama`.

Env vars: `PORT`, `HOST`, `PHOLAMA_MODELS` (model folder), `OLLAMA_URL`, `LLAMA_SERVER_DIR`.


## Chat agent: tools, search, MCP, thinking (PC host)

When you run the host on a PC, chat can use tools. They cost **daily credits** (1000 per day, resets at local midnight):

| Feature | Cost |
|---|---|
| Live web search | 20 per search |
| Read a web page | 10 |
| Calculator / clock | 1 |
| MCP tool call | 15 |
| Thinking mode | 25 per message |

Plain local chat is always free. **When credits hit 0, search, tools, MCP and thinking switch off** and the model answers on its own (so it can be wrong on math or recent facts). The meter is in the header; **Tools** opens the toggles.

- **Search:** uses DuckDuckGo's HTML page, no API key. It may be blocked on some networks.
- **MCP:** add HTTP (streamable) MCP servers in Tools. stdio MCP servers are not supported yet.
- **Small models and tools:** 0.5B models rarely emit tool calls on their own, so the host also detects obvious requests (math, date, "search for ...", a pasted URL) and runs the tool first. Bigger models use tools by themselves.
- **Cloud models:** shown as "coming soon".
- Credits are tracked by the host in `~/.pholama/state.json`. This is pacing, not security: anyone with access to your PC can edit it. Change the limit with `PHOLAMA_DAILY_CREDITS`.
- Tools and credits are PC-host only. The phone-only browser mode is plain chat.

API: `GET /api/credits`, `POST /api/prefs`, `GET/POST/DELETE /api/mcp`, and `POST /api/chat` with `"agent": true`.

## Files
- `web/` chat UI + PWA (shared by phone and PC)
- `server/server.js` local host (zero dependencies)
- `server/agent.js` credits, tools, MCP, agent loop
- `models.json` model catalog (browser + PC lists)
