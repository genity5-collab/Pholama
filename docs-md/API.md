# Use your local AI in a game or website

Pholama runs the AI on your PC and answers at `http://localhost:11435`, the same way Ollama does. Nothing leaves your PC and it is free. While Pholama is running you can also open `http://localhost:11435/api/docs` for copy-paste examples.

## Before you start

1. Start Pholama and download a model in **Models**.
2. Model names look like `gguf:qwen2.5-7b`. List yours with `GET /v1/models`.
3. Your PC must be on and Pholama running.

## Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/v1/models` | List models (OpenAI style) |
| POST | `/v1/chat/completions` | Chat. Supports `stream`, `temperature`, `max_tokens`, system messages |
| POST | `/v1/completions` | Plain text completion |
| POST | `/v1/embeddings` | Turn text into numbers, for search |
| GET | `/api/tags` | List models (Ollama style) |
| POST | `/api/chat`, `/api/generate` | Chat and generate (Ollama style, streamed) |
| POST | `/api/show` | Model details and abilities (`tools`, `thinking`) |
| GET | `/api/ps` | Which model is loaded now |
| GET | `/api/version` | Pholama version |

These routes are **plain chat**. They do not use Pholama's built-in tools, credits or GitHub. Your own code decides what to do with the answers.

## A website or web game

A page opened from `http://localhost:<any port>` can call the API directly:

```js
const r = await fetch("http://localhost:11435/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "gguf:qwen2.5-7b",
    messages: [
      { role: "system", content: "You are a shopkeeper in a fantasy game. Keep answers short." },
      { role: "user", content: "What do you sell?" }
    ]
  })
});
console.log((await r.json()).choices[0].message.content);
```

Set `stream: true` to get the words as they are written (server-sent events, ending with `data: [DONE]`).

**Other websites are blocked on purpose**, so a random site can never use your AI. To allow one site, start Pholama with its address:

```
set PHOLAMA_ORIGINS=https://my-game.example.com      (Windows)
PHOLAMA_ORIGINS=https://my-game.example.com pholama  (Mac/Linux)
```

## Python and the OpenAI library

```python
from openai import OpenAI
c = OpenAI(base_url="http://localhost:11435/v1", api_key="not-needed-on-this-pc")
r = c.chat.completions.create(model="gguf:qwen2.5-7b", messages=[{"role": "user", "content": "Hi!"}])
print(r.choices[0].message.content)
```

## Another device, or a published Roblox game

`localhost` only works on the PC itself. A published Roblox game runs on Roblox's servers, so it cannot see your PC. To reach it from outside:

1. In Pholama open **Settings > Remote access** and make an **API key**. Keys can only chat; they can never run tools or commands on your PC.
2. Give your PC a public address with a tunnel such as **Tailscale** or **Cloudflare Tunnel**.
3. Call `https://your-address/v1/chat/completions` with the header `Authorization: Bearer YOUR_KEY`.

Only do this on a tunnel you trust, and never put the key inside a script that players can read. Keep it in a server Script.

## Roblox Studio

A Studio **plugin** runs on your PC, so it can use `localhost` directly. In Studio turn on **Game Settings > Security > Allow HTTP Requests**, then:

```lua
local HttpService = game:GetService("HttpService")

local function askAI(messages)
	local res = HttpService:RequestAsync({
		Url = "http://localhost:11435/v1/chat/completions",
		Method = "POST",
		Headers = { ["Content-Type"] = "application/json" },
		Body = HttpService:JSONEncode({ model = "gguf:qwen2.5-7b", messages = messages }),
	})
	return HttpService:JSONDecode(res.Body).choices[1].message.content
end

print(askAI({ { role = "user", content = "Write a Luau function that spawns a part." } }))
```

### Do I have to write my own prompt to make the AI run tools?

**For plain chat, no.** Send messages and you get answers.

**For tools (editing scripts, creating parts), yes, the plugin has to do the work**, because the `/v1` routes are plain chat on purpose. Pholama's built-in tools only run inside the Pholama app. A plugin needs three things:

1. **A tool prompt.** Tell the model which tools exist and the exact format to call them. Use a model labelled **Runs tools** (for example Qwen2.5 7B or Qwen3 8B). Small models follow this badly.
2. **A loop.** Read the reply. If it contains a tool call, run it in Studio, add the result to the messages, and ask again. Stop when the reply has no tool call or after a step limit.
3. **Your own safety checks.** Only allow the tools you wrote, limit how often they run, and wrap edits in `ChangeHistoryService` recordings so the user can press Undo.

A minimal prompt and loop:

```lua
local SYSTEM = [[You help edit a Roblox game. To use a tool, reply with ONLY one line:
<tool_call>{"name": "TOOL", "arguments": {...}}</tool_call>
Tools:
- read_script: {"path": "ServerScriptService.Main"}  returns the source
- set_script: {"path": "...", "source": "..."}  replaces the source
After the result arrives, continue. When finished, answer in plain words.]]

local messages = { { role = "system", content = SYSTEM }, { role = "user", content = "Make Main print hello" } }
for step = 1, 6 do
	local reply = askAI(messages)
	local json = reply:match("<tool_call>(.-)</tool_call>")
	if not json then print(reply) break end
	local call = HttpService:JSONDecode(json)
	local result = runMyTool(call.name, call.arguments) -- you write this: look the tool up in a table you control
	table.insert(messages, { role = "assistant", content = reply })
	table.insert(messages, { role = "user", content = "Tool result: " .. tostring(result) })
end
```

This is the same loop Pholama uses itself. Tip: run `GET /api/show` with your model to check it lists `tools` in its abilities before you rely on it.

## Good to know

- The first message after starting is slower while the model loads.
- One model is loaded at a time. A request for a different model swaps it.
- Pholama stops local AIs if your PC starts to lag, so a game that calls the API may get an error. Handle errors and retry.
