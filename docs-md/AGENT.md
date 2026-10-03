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
- **Small models and tools:** 0.5B models rarely emit tool calls on their own, so the host also detects obvious requests (math, date, "search for ...", a pasted URL) and runs the tool first. Bigger models use tools by themselves.
- **Cloud models:** shown as "coming soon".
- Credits are tracked by the host in `~/.pholama/state.json`. This is pacing, not security: anyone with access to your PC can edit it. Change the limit with `PHOLAMA_DAILY_CREDITS`.
- Tools and credits are PC-host only. The phone-only browser mode is plain chat.

API: `GET /api/credits`, `POST /api/prefs`, `GET/POST/DELETE /api/mcp`, and `POST /api/chat` with `"agent": true`.


## The live log

Every AI message on the PC host shows a **live log** above the answer: each step the host takes (checking credits, picking tools, running a tool, the result) with timestamps, then the model's **live thinking** (if the model thinks), then the answer. When it finishes, the log folds into one line you can tap to open again.

Thinking is only charged when the model really produces a thinking block. A model that ignores it is not charged, and the log says so.
