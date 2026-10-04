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

## API (Ollama and OpenAI compatible)

Your games and websites can use the AI on this PC the same way they would use Ollama or OpenAI. See the full guide: [API.md](API.md), or open `http://localhost:11435/api/docs`.

`GET /api/tags`, `POST /api/chat`, `POST /api/generate` stream NDJSON like Ollama. `GET /v1/models`, `POST /v1/chat/completions`, `/v1/completions` and `/v1/embeddings` work like OpenAI.
Plus `GET /api/hardware`, `POST /api/pull {id}`, `POST /api/install-llama`.

Env vars: `PORT`, `HOST`, `PHOLAMA_MODELS` (model folder), `PHOLAMA_WORKSPACE` (the AI's file folder), `PHOLAMA_ORIGINS` (websites allowed to call the API), `OLLAMA_URL`, `LLAMA_SERVER_DIR`.

## Keeping the PC smooth

While a local AI is running, Pholama checks the PC every few seconds. It stops **all local AIs** (and nothing else) when the lag is real and lasts about 12 seconds: memory almost full, the PC freezing up, or the CPU maxed out for a long time. Short spikes while a model loads are ignored. Agent Max in the cloud is never affected.

Closing Pholama (`pholama stop`, closing the window, Ctrl+C) stops every local AI as well. If Pholama was force-killed, the leftover AI is cleaned up the next time it starts.

## Remove Pholama

```
pholama remove-all             # lists everything, asks you to type: remove
pholama remove-all --dry-run   # only shows what would be deleted
pholama rm <model>             # remove just one model
```

It removes the app folder, all models, the private Node.js, llama.cpp, the `pholama` command and the Desktop / Start Menu icons. Your browser chats and other programs are not touched.


## Duo on the PC

Turn on **Duo** in **Models** to let a small downloaded model prepare hints while a bigger one answers. The PC runs the helper as a second engine on its own port, so pick a helper that is at most 60% of the main model. Both engines are stopped when you close Pholama, when the lag guard stops local AIs, and when you turn Duo off. If memory is tight or the helper fails, Pholama answers with one AI and tells you why. The PC app keeps up to **15** memories.
