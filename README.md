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

## Files
- `web/` chat UI + PWA (shared by phone and PC)
- `server/server.js` local host (zero dependencies)
- `models.json` model catalog (browser + PC lists)
