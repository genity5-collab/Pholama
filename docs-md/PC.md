# Pholama on a PC

[Back to start](../README.md)



You do not need to install anything first. The one-line installer downloads its own private Node.js (about 30 MB) if your PC has none. If you run from a git clone instead (below), that route needs [Node.js 18+](https://nodejs.org).

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

## Chat from your phone over WiFi

```
HOST=0.0.0.0 node server/server.js          # Windows: set HOST=0.0.0.0 && node server\server.js
```
Then open `http://<your-PC-IP>:11435` on your phone. The phone uses the PC's power.
Only do this on a network you trust: there is no login.

## API (Ollama-compatible)

`GET /api/tags`, `POST /api/chat`, `POST /api/generate` stream NDJSON like Ollama.
Plus `GET /api/hardware`, `POST /api/pull {id}`, `POST /api/install-llama`.

Env vars: `PORT`, `HOST`, `PHOLAMA_MODELS` (model folder), `OLLAMA_URL`, `LLAMA_SERVER_DIR`.



