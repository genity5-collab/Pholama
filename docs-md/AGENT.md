# Chat agent: tools, search, MCP, thinking

[Back to start](../README.md)



When you run the host on a PC, chat can use tools. **All tools are free.** Only thinking mode uses **daily credits** (1000 per day, resets at local midnight):

| Feature | Cost |
|---|---|
| Live web search, read a page | Free |
| Calculator, clock, memory | Free |
| MCP tools, GitHub, run a command | Free |
| Thinking mode | 25 per message |

Plain local chat is always free. **When credits hit 0, only thinking mode switches off.** Search, tools, MCP, GitHub and commands keep working. The meter is in the header; **Tools** opens the toggles.

- **Search:** uses DuckDuckGo's HTML page, no API key. It may be blocked on some networks.
- **MCP:** add HTTP (streamable) MCP servers in Tools. stdio MCP servers are not supported yet.
- **Which models get tools:** only models that can really call tools. Downloaded models use the `tools` tag in the model list. Ollama models report their own abilities (`/api/show`). A model that can't, or whose abilities can't be read, gets a plain chat prompt and the live log says why. Pholama never guesses.
- **Small tool models:** even tool-capable 1B models sometimes skip the tool format, so for them the host also spots obvious requests (math, date, "search for ...", a pasted URL) and runs the tool first.
- **Agent Max** is the cloud model (see below).
- Credits are tracked by the host in `~/.pholama/state.json`. This is pacing, not security: anyone with access to your PC can edit it. Change the limit with `PHOLAMA_DAILY_CREDITS`.
- Tools and credits are PC-host only. The phone-only browser mode is plain chat.

API: `GET /api/credits`, `POST /api/prefs`, `GET/POST/DELETE /api/mcp`, and `POST /api/chat` with `"agent": true`.


## The live log

Every AI message on the PC host shows a **live log** above the answer: each step the host takes (checking credits, picking tools, running a tool, the result) with timestamps, then the model's **live thinking** (if the model thinks), then the answer. When it finishes, the log folds into one line you can tap to open again.

Thinking is only charged when the model really produces a thinking block. A model that ignores it is not charged, and the log says so.


## Switches above the message box

Under the model picker you'll see small buttons: **Search**, **Tools**, **MCP**, **Thinking**.

- A button only shows if the selected model can do it. A model with no tools shows a note instead: "Plain chat: this model does not support tools."
- For a capable model they start **on**. Tap to turn one off; Pholama remembers it.
- **MCP** also needs at least one MCP server added. The **Tools** window is still the master switch: a feature turned off there is hidden here.
- Thinking is on by default for models that can think. It is only charged when the model really thinks.

## Tokens

Each reply ends with a line like `42 in · 17 out · 59 tokens · 1.3s`. *In* is what was sent to the model (your message, history, instructions). *Out* is what it wrote.

- The number is **exact** when the model reports it (Ollama, llama.cpp, and the phone GPU and CPU models all do).
- If a model doesn't, the line starts with `~` and ends with `(estimated)`: about 4 characters per token.

## The AI doesn't talk about its instructions

Pholama's instructions are private. The AI is told to answer from your message, and never to quote or describe them. If a small model slips anyway, the host hides that part and shows "I can't share that." A model with no tools is also told so, and if it claims it can browse the web when you ask, the host replaces that with a true answer.


## Agent Max

A cloud assistant that needs no download. Sign in, pick **Agent Max** in the model list.

- **Limits:** 10 messages per day and 30 per month per account (UTC). Normal, Long and Max effort each count as 1. The daily 10 come back every day until you reach 30; after that it restocks next month. A failed reply is not counted. Local models are always free.
- **With a local AI:** once a PC model that runs tools is installed (for example Qwen2.5 1.5B), the daily allowance drops to **1 message a day**, because the local AI is free and unlimited. Remove it and the allowance returns to 10. The monthly limit stays 30.
- **Tools:** calculator, clock, a Pholama help lookup, and page controls.
- **Page controls:** ask it to open Models, Tools or Account, close the windows, start a new session, set Normal/Long/Max, or check your limits. It can only use that fixed list.
- **Effort:** Long and Max let it think in more steps before answering.
- It cannot browse the web or see your files.
- Backend: `functions/pholamaCloud.ts` (rebuild with `python3 tools/build_max_knowledge.py && python3 tools/build_agent_max.py`). The usage table and limit functions live in Supabase.


## GitHub tools (any tool-capable model, on your PC)

Local models that support tools can use GitHub for free (no cloud credits). Public repos need no token.

- **Read (free):** search repos, read a file, list issues, repo info.
- **Write (free):** create an issue, comment, write a file. These never run on their own: the chat shows **Allow / Deny** and nothing happens until you press Allow. Requests expire after 10 minutes and cannot be reused.
- **Token:** paste a GitHub token in Tools. It stays in your browser on this device and is sent to your own PC only. Clear it any time.
- Models without tool support are never given these tools.
- The credits left today show beside the message box.

## Agent Max brain

Agent Max now thinks with Groq (model `qwen/qwen3.8-27b`, backup `openai/gpt-oss-120b`). It no longer uses Base44 integration credits. The key is stored as a server secret, never in the page. The 10/day and 30/month limits still apply.

## Use your PC's AI from anywhere (API key)

Your PC host can be reached from your phone or another app. Nothing is open to the internet until you choose to do it.

1. **On the PC**, open Settings > Remote access > Create key. The full key (`phk_...`) is shown **once**. Copy it. Only a hash is stored on the PC (`~/.pholama/keys.json`).
2. **Same WiFi:** start the host with `HOST=0.0.0.0`, then on the phone open Settings > Remote access and enter `http://<PC-IP>:11435` and the key.
3. **From anywhere:** put a secure tunnel in front of the PC (for example Tailscale, or a Cloudflare Tunnel) and use its `https://` address. Tailscale is the safest: only your own devices can reach it.
4. **Other apps** can use the OpenAI format: base URL `http://<address>:11435/v1`, API key = your `phk_` key, model names from `/v1/models`.

Safety rules built in:
- The PC itself needs no key. Everything else does.
- Requests through a tunnel count as remote, so they always need a key.
- Keys can be created and revoked only on the PC, never remotely.
- 8 wrong keys from one address locks it out for 10 minutes.
- Other websites cannot call your host from a browser. Only the Pholama site, this PC, and origins you list in `PHOLAMA_ORIGINS` can.
- Remote callers get plain chat only: no web search, no GitHub, no MCP, and no local credits are spent.
- Use HTTPS (a tunnel) over the internet. A key sent over plain `http://` on public networks can be read by others.
