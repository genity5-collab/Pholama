# Chat agent: tools, search, MCP, thinking

[Back to start](../README.md)



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
- **Tools:** calculator, clock, a Pholama help lookup, and page controls.
- **Page controls:** ask it to open Models, Tools or Account, close the windows, start a new session, set Normal/Long/Max, or check your limits. It can only use that fixed list.
- **Effort:** Long and Max let it think in more steps before answering.
- It cannot browse the web or see your files.
- Backend: `functions/pholamaCloud.ts` (rebuild with `python3 tools/build_max_knowledge.py && python3 tools/build_agent_max.py`). The usage table and limit functions live in Supabase.
