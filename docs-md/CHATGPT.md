# Connect ChatGPT to Pholama

Pholama can act as an MCP server, so ChatGPT can ask your PC a few things. It is **off** until you turn it on.

## What ChatGPT can do
Four read-only tools, and nothing else:

| Tool | What it does |
|---|---|
| `pholama_news` | Reads the newest Pholama releases |
| `web_search` | Searches the web with Pholama's search |
| `list_models` | Lists the AI models installed on your PC |
| `credits_left` | Shows how many credits are left today |

It cannot read or write your files, run commands, use GitHub, see your API keys, or touch Studio. Those tools do not exist on this connection, so there is nothing to misuse.

## Set it up
1. In Pholama on your PC, open **Models** and find **Connect ChatGPT to Pholama**. Turn the switch on.
2. Press **Make a ChatGPT key** and copy it. It is shown once.
3. ChatGPT needs a public https address. Install Tailscale and run `tailscale funnel 11435`. Copy the https address it prints.
4. In ChatGPT: **Settings > Connectors > Advanced > Developer mode** (a paid plan is needed).
5. Add a connector. Paste your address ending in `/mcp`, choose a Bearer / API key, and paste the key from step 2.

## Safety
- A key is **always** needed, even from your own PC, because a tunnel makes outside requests look like they come from your PC.
- Too many wrong keys get locked out for a few minutes.
- Remove the key any time in **Settings > Remote access** and it stops working at once.
- `web_search` uses your daily credits. If you see credits dropping that you did not use, remove the key.
- Turn the switch off and the address answers "not found" to everyone.

## For developers
`POST /mcp`, JSON-RPC 2.0, Streamable HTTP without sessions or streaming. Methods: `initialize`, `ping`, `tools/list`, `tools/call`. Protocol versions 2025-06-18, 2025-03-26 and 2024-11-05. Batches up to 8 messages, bodies up to 64 KB.
