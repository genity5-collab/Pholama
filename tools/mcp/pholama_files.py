"""Pholama bundled MCP server (stdio). Standard library only, no pip install needed.
Tool surface follows local-llm-mcp-tool (read_file, analyze_file, sessions) but the model work is done by Pholama itself:
analyze_file here returns the file plus simple facts, and Pholama's own model writes the analysis. Every path stays inside
one folder (PHOLAMA_MCP_ROOT, default ~/.pholama/workspace). Nothing outside it can be read, and nothing is written except sessions."""
import json, os, sys, time, uuid

ROOT = os.path.realpath(os.environ.get("PHOLAMA_MCP_ROOT") or os.path.join(os.path.expanduser("~"), ".pholama", "workspace"))
HIST = os.path.join(os.path.realpath(os.environ.get("PHOLAMA_MCP_HOME") or os.path.join(os.path.expanduser("~"), ".pholama")), "mcp-sessions")
MAX_BYTES = 200000
MAX_MSGS = int(os.environ.get("SESSION_MAX_MESSAGES", "40"))
os.makedirs(ROOT, exist_ok=True)

def safe(rel):
    rel = str(rel or "").replace("\\", "/").lstrip("/")
    if "\0" in rel or any(p == ".." for p in rel.split("/")) or (len(rel) > 1 and rel[1] == ":"):
        raise ValueError("that path is not allowed")
    full = os.path.realpath(os.path.join(ROOT, rel))
    if full != ROOT and not full.startswith(ROOT + os.sep):
        raise ValueError("that path is outside the workspace")
    return full

def read_file(a):
    p = safe(a.get("path")); mb = max(1, min(int(a.get("max_bytes") or MAX_BYTES), MAX_BYTES))
    if not os.path.isfile(p): raise ValueError("no such file")
    with open(p, "rb") as f: data = f.read(mb + 1)
    return data[:mb].decode(a.get("encoding") or "utf-8", "replace") + ("\n...[cut]" if len(data) > mb else "")

def analyze_file(a):
    text = read_file(a); lines = text.split("\n")
    words = len(text.split()); ext = os.path.splitext(str(a.get("path")))[1] or "(none)"
    head = "File: %s | type %s | %d lines | %d words\nInstruction: %s\n---\n" % (a.get("path"), ext, len(lines), words, a.get("instruction") or "Summarize purpose, structure, issues and improvements.")
    return head + text[:12000]

def list_dir(a):
    p = safe(a.get("path") or "."); 
    if not os.path.isdir(p): raise ValueError("not a folder")
    out = []
    for n in sorted(os.listdir(p))[:300]:
        out.append(("[dir] " if os.path.isdir(os.path.join(p, n)) else "") + n)
    return "\n".join(out) or "(empty)"

def _sf(sid):
    if not sid or not all(c.isalnum() or c in "-_" for c in str(sid)) or len(str(sid)) > 64: raise ValueError("bad session id")
    return os.path.join(HIST, str(sid) + ".json")

def start_session(a):
    os.makedirs(HIST, exist_ok=True); sid = uuid.uuid4().hex[:12]
    json.dump({"id": sid, "created": time.time(), "metadata": a.get("metadata") or {}, "messages": [], "ended": False}, open(_sf(sid), "w"))
    return sid

def continue_session(a):
    p = _sf(a.get("session_id"))
    if not os.path.isfile(p): raise ValueError("no such session")
    s = json.load(open(p))
    if s.get("ended"): raise ValueError("that session has ended")
    s["messages"].append({"role": "user", "content": str(a.get("message") or "")[:8000], "t": time.time()})
    s["messages"] = s["messages"][-MAX_MSGS:]
    json.dump(s, open(p, "w"))
    return json.dumps({"session_id": s["id"], "messages": s["messages"][-MAX_MSGS:]})

def end_session(a):
    p = _sf(a.get("session_id"))
    if not os.path.isfile(p): raise ValueError("no such session")
    if a.get("delete"): os.remove(p); return "deleted"
    s = json.load(open(p)); s["ended"] = True; json.dump(s, open(p, "w")); return "ended"

OBJ = lambda props, req=(): {"type": "object", "properties": props, "required": list(req)}
S = {"type": "string"}; I = {"type": "integer"}
TOOLS = {
    "read_file": (read_file, "Read a text file inside the Pholama workspace.", OBJ({"path": S, "max_bytes": I, "encoding": S}, ["path"])),
    "analyze_file": (analyze_file, "Read a file and return it with simple facts so the model can analyze it.", OBJ({"path": S, "instruction": S, "max_bytes": I}, ["path"])),
    "list_dir": (list_dir, "List a folder inside the workspace.", OBJ({"path": S})),
    "start_session": (start_session, "Start a saved conversation session and return its id.", OBJ({"metadata": {"type": "object"}})),
    "continue_session": (continue_session, "Add a message to a session and return the recent history.", OBJ({"session_id": S, "message": S}, ["session_id", "message"])),
    "end_session": (end_session, "End a session, or delete it with delete=true.", OBJ({"session_id": S, "delete": {"type": "boolean"}}, ["session_id"])),
}

def reply(i, result=None, error=None):
    m = {"jsonrpc": "2.0", "id": i}
    if error is not None: m["error"] = {"code": -32000, "message": error}
    else: m["result"] = result
    sys.stdout.write(json.dumps(m) + "\n"); sys.stdout.flush()

def main():
    for line in sys.stdin:
        line = line.strip()
        if not line: continue
        try: m = json.loads(line)
        except Exception: continue
        i, method, params = m.get("id"), m.get("method"), m.get("params") or {}
        if i is None: continue                                  # notifications need no reply
        if method == "initialize":
            reply(i, {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "serverInfo": {"name": "pholama-files", "version": "1.0"}})
        elif method == "tools/list":
            reply(i, {"tools": [{"name": n, "description": d, "inputSchema": s} for n, (f, d, s) in TOOLS.items()]})
        elif method == "tools/call":
            t = TOOLS.get(params.get("name"))
            if not t: reply(i, error="unknown tool"); continue
            try: reply(i, {"content": [{"type": "text", "text": str(t[0](params.get("arguments") or {}))}]})
            except Exception as e: reply(i, {"content": [{"type": "text", "text": "Error: " + str(e)[:300]}], "isError": True})
        else: reply(i, error="unsupported: " + str(method))

if __name__ == "__main__":
    main()
