// The page at /api/docs: how a game or website uses the AI running on this PC. Zero dependencies.
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function page(port) {
  const B = 'http://localhost:' + port;
  const ex = {
    web: `// A web page opened from http://localhost (or a site you allowed, see below)
const r = await fetch("${B}/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "gguf:qwen2.5-7b",            // any model from GET /v1/models
    messages: [
      { role: "system", content: "You are a shopkeeper in a fantasy game. Keep answers short." },
      { role: "user", content: "Hello, what do you sell?" }
    ]
  })
});
const data = await r.json();
console.log(data.choices[0].message.content);`,
    stream: `// Streaming: show the words as they are written
const r = await fetch("${B}/v1/chat/completions", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ model: "gguf:qwen2.5-7b", stream: true, messages: [{ role: "user", content: "Tell me a joke" }] })
});
const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "";
for (;;) {
  const { done, value } = await rd.read(); if (done) break;
  buf += dec.decode(value, { stream: true });
  for (const line of buf.split("\\n\\n").slice(0, -1)) {
    const d = line.replace(/^data: /, "").trim(); if (!d || d === "[DONE]") continue;
    const t = JSON.parse(d).choices[0].delta.content; if (t) document.body.append(t);
  }
  buf = buf.slice(buf.lastIndexOf("\\n\\n") + 2);
}`,
    py: `# pip install openai     (works with the normal OpenAI library)
from openai import OpenAI
c = OpenAI(base_url="${B}/v1", api_key="not-needed-on-this-pc")
r = c.chat.completions.create(model="gguf:qwen2.5-7b", messages=[{"role": "user", "content": "Hi!"}])
print(r.choices[0].message.content)`,
    curl: `curl ${B}/v1/chat/completions -H "Content-Type: application/json" \\
  -d '{"model":"gguf:qwen2.5-7b","messages":[{"role":"user","content":"Hi!"}]}'`,
    roblox: `-- Roblox cannot reach "localhost" on your PC. Use a tunnel (Tailscale or Cloudflare Tunnel) so your PC has a public address,
-- make an API key in Pholama (Settings > Remote access), then from a server Script:
local HttpService = game:GetService("HttpService")
local res = HttpService:RequestAsync({
  Url = "https://YOUR-TUNNEL-ADDRESS/v1/chat/completions", Method = "POST",
  Headers = { ["Content-Type"] = "application/json", ["Authorization"] = "Bearer YOUR_PHOLAMA_KEY" },
  Body = HttpService:JSONEncode({ model = "gguf:qwen2.5-7b", messages = { { role = "user", content = "Hello" } } })
})
print(HttpService:JSONDecode(res.Body).choices[1].message.content)`,
    ollama: `# Ollama-style calls work too
curl ${B}/api/tags                     # list models
curl ${B}/api/generate -d '{"model":"gguf:qwen2.5-7b","prompt":"Why is the sky blue?"}'
curl ${B}/api/show -d '{"model":"gguf:qwen2.5-7b"}'
curl ${B}/v1/embeddings -d '{"model":"gguf:qwen2.5-7b","input":"hello"}'`,
    ollamaNative: `# Full native Ollama API (when Ollama is installed and running on this PC)
curl ${B}/api/ollama/tags
curl ${B}/api/ollama/chat -d '{"model":"llama3.2","messages":[{"role":"user","content":"Hi"}],"tools":[],"stream":false}'
curl ${B}/api/ollama/ps
curl ${B}/api/ollama/show -d '{"model":"llama3.2"}'
curl ${B}/api/ollama/pull -d '{"name":"llama3.2"}'
curl ${B}/api/ollama/embed -d '{"model":"nomic-embed-text","input":"hello"}'
# /api/ollama/create, /copy, /delete and /push are supported on this PC too.
# push uploads to the Ollama registry you specify; run it only when you intend to publish.`
  };
  const rows = [
    ['GET', '/v1/models', 'List your models (OpenAI style)'], ['POST', '/v1/chat/completions', 'Chat. Supports stream, temperature, max_tokens, system messages'],
    ['POST', '/v1/completions', 'Plain text completion'], ['POST', '/v1/embeddings', 'Text to numbers (for search). Needs a model that supports it'],
    ['GET', '/api/tags', 'List models (Ollama style)'], ['POST', '/api/generate', 'Generate from a prompt (Ollama style)'], ['POST', '/api/chat', 'Chat (Ollama style)'],
    ['POST', '/api/show', 'Model details and abilities'], ['GET', '/api/ps', 'Which model is loaded now'], ['GET', '/api/version', 'Pholama version'],
    ['GET/POST', '/api/ollama/*', 'Native Ollama passthrough; model downloads/changes are local-only']
  ];
  const code = (t) => `<pre><code>${esc(t)}</code></pre>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pholama local API</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:24px auto;padding:0 16px;color:#1b1f24;background:#fff}h1{margin:0 0 4px}h2{margin-top:30px}
pre{background:#0f1720;color:#e6edf3;padding:12px 14px;border-radius:8px;overflow:auto;font-size:13px}code{font-family:ui-monospace,Consolas,monospace}table{border-collapse:collapse;width:100%}
td,th{border-bottom:1px solid #e3e6ea;padding:6px 8px;text-align:left;font-size:14px}.m{font-weight:700;color:#2f6feb}.n{background:#fff8e1;border:1px solid #f0d98a;padding:10px 12px;border-radius:8px}</style></head><body>
<h1>Use the AI on this PC in your game or website</h1><p>Pholama runs the AI on your computer and answers at <b>${esc(B)}</b>, the same way Ollama does. It is free and private: nothing leaves your PC.</p>
<div class="n"><b>Keep in mind:</b> the AI must be installed (Models tab) and your PC must be on. Only pages opened from <code>localhost</code> can call it by default, so a random website can never use your AI. To allow one site, start Pholama with <code>PHOLAMA_ORIGINS=https://your-site.com</code>. For other devices or games (like Roblox), make an API key in Settings and use a tunnel such as Tailscale.</div>
<h2>Endpoints</h2><table>${rows.map(r => `<tr><td class="m">${r[0]}</td><td><code>${esc(r[1])}</code></td><td>${esc(r[2])}</td></tr>`).join('')}</table>
<p>Pholama model names look like <code>gguf:qwen2.5-7b</code>. The original-style <code>/api/chat</code> and <code>/api/generate</code> also pass an unprefixed Ollama model name through unchanged; use <code>/api/ollama/…</code> for the full native API. This preserves Ollama options such as images, tools, output format and keep-alive. Native pull/create/copy/delete/push endpoints only work from this PC; push publishes to a registry. Pholama's own model routes are plain chat: they do not run Pholama tools, use credits, or touch GitHub.</p>
<h2>Website (JavaScript)</h2>${code(ex.web)}<h2>Streaming</h2>${code(ex.stream)}<h2>Python</h2>${code(ex.py)}<h2>curl</h2>${code(ex.curl)}
<h2>Roblox game</h2>${code(ex.roblox)}<h2>Ollama-style</h2>${code(ex.ollama)}<h2>Full native Ollama API</h2>${code(ex.ollamaNative)}</body></html>`;
}
module.exports = { page };
