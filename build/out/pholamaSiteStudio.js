// functions/siteStudioCore.ts
var LIMITS = { MAX_FILE: 400 * 1024, MAX_FILES: 60, MAX_TOTAL: 4 * 1024 * 1024, MAX_PROJECTS: 5, MAX_SECRETS: 10, MAX_DB_BYTES: 10 * 1024 * 1024 };
var OK_EXT = /* @__PURE__ */ new Set([".html", ".htm", ".css", ".js", ".mjs", ".json", ".md", ".txt", ".svg", ".csv"]);
var bytes = (s) => new TextEncoder().encode(s).length;
function projName(s) {
  const n = String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 60);
  if (!n) throw new Error("give the project a name (letters, numbers, dashes)");
  return n;
}
function fileName(f) {
  const s = String(f ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!s || s.length > 100 || s.includes("\0") || s.split("/").some((p) => !p || p === "." || p === ".." || p.startsWith("."))) throw new Error("bad file name: " + s.slice(0, 40));
  if (!/^[A-Za-z0-9_\-./ ]+$/.test(s)) throw new Error("file names may use letters, numbers, dash, underscore, dot");
  const ext = s.includes(".") ? s.slice(s.lastIndexOf(".")).toLowerCase() : "";
  if (!OK_EXT.has(ext)) throw new Error("only " + [...OK_EXT].join(" ") + " files are allowed");
  return s;
}
function jsBroken(name, text) {
  if (!/\.m?js$/i.test(name)) return "";
  try {
    new Function(String(text));
    return "";
  } catch (e) {
    const m = String(e.message);
    return /import|export|await|module/.test(m) ? "" : m;
  }
}
async function writeFile(c, p, f, content) {
  const name = fileName(f);
  content = String(content ?? "");
  content = await c.secrets.scrub(p, content);
  if (bytes(content) > LIMITS.MAX_FILE) throw new Error("file too big (max " + LIMITS.MAX_FILE / 1024 + " KB). Split it into smaller files.");
  const files = await c.store.listFiles(p), has = files.some((x) => x.name === name);
  if (!has && files.length >= LIMITS.MAX_FILES) throw new Error("too many files (max " + LIMITS.MAX_FILES + ")");
  const total = files.filter((x) => x.name !== name).reduce((n, x) => n + x.size, 0) + bytes(content);
  if (total > LIMITS.MAX_TOTAL) throw new Error("project too big (max " + LIMITS.MAX_TOTAL / 1048576 + " MB)");
  await c.store.putFile(p, name, content);
  return { name, size: bytes(content), created: !has };
}
async function readFile(c, p, f) {
  const t2 = await c.store.getFile(p, fileName(f));
  if (t2 == null) throw new Error("no such file: " + f);
  return t2;
}
async function deleteFile(c, p, f) {
  const n = fileName(f);
  if (await c.store.getFile(p, n) == null) throw new Error("no such file: " + f);
  await c.store.delFile(p, n);
  return "Deleted " + f;
}
async function guardedWrite(c, p, f, before, after) {
  const was = jsBroken(f, before), now = was ? "" : jsBroken(f, after);
  if (now) throw new Error("That change would break " + f + " (" + now + "), so I did not save it and the file is unchanged. Change fewer lines, or copy the exact lines with studio_read_numbered and try again.");
  await writeFile(c, p, f, after);
}
async function patchFile(c, p, f, find, replace, all) {
  find = String(find ?? "");
  if (!find.trim()) throw new Error('"find" text is required');
  const raw = await readFile(c, p, f), crlf = raw.includes("\r\n"), src = raw.replace(/\r\n/g, "\n");
  const rep = String(replace ?? "").replace(/\r\n/g, "\n"), fnd = find.replace(/\r\n/g, "\n"), out = (t2) => crlf ? t2.replace(/\n/g, "\r\n") : t2;
  let n = 0;
  const i = src.indexOf(fnd);
  if (i >= 0) {
    let k = -1;
    while ((k = src.indexOf(fnd, k + 1)) >= 0) n++;
  }
  if (n > 1 && !all) throw new Error("that text appears " + n + " times in " + f + '. Include more surrounding text so it is unique, or set "all" to true to change every one.');
  if (n >= 1) {
    await guardedWrite(c, p, f, raw, out(all ? src.split(fnd).join(rep) : src.slice(0, i) + rep + src.slice(i + fnd.length)));
    return "Edited " + f + (all && n > 1 ? " (" + n + " places)" : "");
  }
  const sl = src.split("\n"), fl = fnd.split("\n").map((x) => x.trim());
  while (fl.length && !fl[0]) fl.shift();
  while (fl.length && !fl[fl.length - 1]) fl.pop();
  const hits = [];
  if (fl.length) for (let a = 0; a + fl.length <= sl.length; a++) {
    let ok2 = true;
    for (let b = 0; b < fl.length; b++) if (sl[a + b].trim() !== fl[b]) {
      ok2 = false;
      break;
    }
    if (ok2) hits.push(a);
  }
  if (!hits.length) throw new Error("the text to replace was not found in " + f + ". Read the file again (studio_read) and copy the exact lines, or use studio_lines to replace by line number.");
  if (hits.length > 1 && !all) throw new Error("that text appears " + hits.length + " times in " + f + '. Include more surrounding lines so it is unique, or set "all" to true.');
  const mk = (at) => {
    const ind = (k) => (sl[at + Math.min(k, fl.length - 1)].match(/^\s*/) || [""])[0];
    return rep.split("\n").map((x, k) => x.trim() ? ind(k) + x.replace(/^\s+/, "") : x);
  };
  for (const a of all ? hits.slice().reverse() : [hits[0]]) sl.splice(a, fl.length, ...mk(a));
  await guardedWrite(c, p, f, raw, out(sl.join("\n")));
  return "Edited " + f + " (matched ignoring spacing)" + (all && hits.length > 1 ? ", " + hits.length + " places" : "");
}
async function editLines(c, p, f, from, to, text) {
  const raw = await readFile(c, p, f), crlf = raw.includes("\r\n"), lines = raw.replace(/\r\n/g, "\n").split("\n");
  const a = Math.floor(+from);
  if (!(a >= 1 && a <= lines.length + 1)) throw new Error('"from" must be a line number between 1 and ' + (lines.length + 1) + " (the file has " + lines.length + " lines)");
  const insert2 = to == null || to === "", b = insert2 ? a - 1 : Math.floor(+to);
  if (!insert2 && !(b >= a && b <= lines.length)) throw new Error('"to" must be a line number from ' + a + " to " + lines.length);
  const add = text == null || String(text) === "" ? [] : String(text).replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  lines.splice(a - 1, insert2 ? 0 : b - a + 1, ...add);
  const res = lines.join("\n");
  await guardedWrite(c, p, f, raw, crlf ? res.replace(/\n/g, "\r\n") : res);
  return (insert2 ? "Inserted " + add.length + " line(s) before line " + a : add.length ? "Replaced lines " + a + "-" + b + " with " + add.length + " line(s)" : "Deleted lines " + a + "-" + b) + " in " + f;
}
async function readNumbered(c, p, f) {
  const l = (await readFile(c, p, f)).replace(/\r\n/g, "\n").split("\n"), w = String(l.length).length;
  return l.map((x, k) => String(k + 1).padStart(w) + " | " + x).join("\n");
}
async function createProject(c, name) {
  const n = projName(name);
  if (await c.store.hasProject(n)) return { name: n, existed: true };
  if ((await c.store.listProjects()).length >= LIMITS.MAX_PROJECTS) throw new Error("You can have " + LIMITS.MAX_PROJECTS + " website projects. Delete one first.");
  await c.store.createProject(n);
  await c.store.putFile(n, "index.html", `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${n}</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<h1>${n}</h1>
<script src="script.js"></script>
</body>
</html>
`);
  await c.store.putFile(n, "style.css", "body { font-family: system-ui, sans-serif; margin: 2rem; }\n");
  await c.store.putFile(n, "script.js", `console.log('${n} is running');
`);
  return { name: n, existed: false };
}
async function check(c, p) {
  const files = await c.store.allFiles(p), names = Object.keys(files), out = [];
  if (!names.length) return ["The project has no files."];
  if (!files["index.html"]) out.push("There is no index.html, so the preview has nothing to open.");
  for (const [n, t2] of Object.entries(files)) {
    const s = jsBroken(n, t2);
    if (s) out.push(n + ": script error: " + s);
    if (/\.html?$/i.test(n)) {
      const ids = [...t2.matchAll(/\sid=["']([^"']+)["']/g)].map((m) => m[1]), seen = /* @__PURE__ */ new Set();
      for (const id of ids) {
        if (seen.has(id)) out.push(n + ': the id "' + id + '" is used more than once.');
        seen.add(id);
      }
      for (const m of t2.matchAll(/(?:src|href)=["']([^"'#?]+)["']/g)) {
        const u = m[1];
        if (/^(https?:|data:|mailto:|\/\/)/i.test(u)) continue;
        const base = n.includes("/") ? n.slice(0, n.lastIndexOf("/") + 1) : "";
        const target = (u.startsWith("/") ? u.slice(1) : base + u).replace(/^\.\//, "");
        if (!names.includes(target)) out.push(n + ': links to "' + u + '" but that file does not exist.');
      }
    }
  }
  return out;
}
var cleanSecretName = (n) => {
  const s = String(n ?? "").trim().replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
  if (!s || s.length > 48 || /^[0-9]/.test(s)) throw new Error("A secret name uses letters, numbers and underscores, and starts with a letter (like OPENAI_API_KEY).");
  if (/^(PATH|HOME|USER|SHELL|PWD|NODE_OPTIONS|LD_PRELOAD|LD_LIBRARY_PATH|PORT)$/.test(s)) throw new Error("That name is used by the system. Pick another.");
  return s;
};
var KNOWN = [
  { name: "GITHUB_TOKEN", re: /\b(gh[pousr]_[A-Za-z0-9]{30,255}|github_pat_[A-Za-z0-9_]{50,255})\b/g },
  { name: "ANTHROPIC_API_KEY", re: /\bsk-ant-[A-Za-z0-9_\-]{30,200}\b/g },
  { name: "OPENAI_API_KEY", re: /\bsk-(?:proj-|live-)?[A-Za-z0-9_\-]{32,200}\b/g },
  { name: "GROQ_API_KEY", re: /\bgsk_[A-Za-z0-9]{40,100}\b/g },
  { name: "RESEND_API_KEY", re: /\bre_[A-Za-z0-9_]{20,100}\b/g },
  { name: "STRIPE_SECRET_KEY", re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{20,120}\b/g },
  { name: "GOOGLE_API_KEY", re: /\bAIza[0-9A-Za-z_\-]{35}\b/g },
  { name: "AWS_ACCESS_KEY_ID", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "SLACK_TOKEN", re: /\bxox[abprs]-[A-Za-z0-9-]{20,200}\b/g },
  { name: "DISCORD_BOT_TOKEN", re: /\b[MN][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,40}\b/g },
  { name: "SUPABASE_SERVICE_KEY", re: /\bsb_secret_[A-Za-z0-9_\-]{20,120}\b/g },
  { name: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g }
];
var WORD = "(?:API[_-]?KEY|APIKEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|AUTH[_-]?KEY|CLIENT[_-]?SECRET|CREDENTIAL)";
var NAMED = () => new RegExp("(^|[\\s;,{(\\[])[\"'`]?([A-Za-z][A-Za-z0-9_-]*?" + WORD + "[A-Za-z0-9_-]*|" + WORD + "[A-Za-z0-9_-]*)[\"'`]?\\s*(?:=|:)\\s*[\"'`]?([^\\s\"'`<>,;]{8,})", "gim");
var SAID = () => new RegExp("\\b((?:my|the|our)\\s+(?:[a-z]+\\s+)?(?:password|passcode|api\\s?key|token|secret(?:\\s?key)?))\\s+(?:is|=|:)\\s+[\"'`]?([^\\s\"'`<>,;]{8,})", "gi");
var PLACEHOLDER = /^(your[_-]?|xxx+|\*+|<|\{\{|\$\{|process\.env|example|changeme|todo|placeholder|insert|none|null|undefined|true|false)/i;
var CODEISH = (v) => /[()\[\]]/.test(v) || /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(v) || /^(get|set|fetch|read|load|create|make|new)[A-Z]/.test(v);
var maskValue = (v) => v.length <= 8 ? "\u2022\u2022\u2022\u2022" : v.slice(0, 3) + "\u2022\u2022\u2022\u2022" + v.slice(-2);
function scanSecrets(text) {
  const src = String(text ?? ""), found = [], taken = [];
  const free = (a, b) => !taken.some(([x, y]) => a < y && b > x);
  for (const k of KNOWN) {
    const re = new RegExp(k.re.source, "g");
    let m2;
    while (m2 = re.exec(src)) {
      const a = m2.index, b = a + m2[0].length;
      if (free(a, b)) {
        taken.push([a, b]);
        found.push({ at: a, end: b, value: m2[0], name: k.name });
      }
    }
  }
  const take = (m2, value, rawName) => {
    if (PLACEHOLDER.test(value) || CODEISH(value) || /^[A-Za-z]+$/.test(value) && value.length < 12) return;
    const a = m2.index + m2[0].lastIndexOf(value), b = a + value.length;
    if (!free(a, b)) return;
    let nm;
    try {
      nm = cleanSecretName(String(rawName).replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/\s+/g, "_"));
    } catch {
      return;
    }
    taken.push([a, b]);
    found.push({ at: a, end: b, value, name: nm });
  };
  let m;
  const n = NAMED();
  while (m = n.exec(src)) take(m, m[3], m[2]);
  const s = SAID();
  while (m = s.exec(src)) take(m, m[2], m[1].replace(/^(my|the|our)\s+/i, ""));
  found.sort((x, y) => x.at - y.at);
  const used = /* @__PURE__ */ new Map();
  let out = "", last = 0;
  for (const f of found) {
    let nm = f.name, i = 2;
    while (used.has(nm) && used.get(nm) !== f.value) nm = f.name + "_" + i++;
    used.set(nm, f.value);
    f.name = nm;
    out += src.slice(last, f.at) + "{{secret:" + nm + "}}";
    last = f.end;
  }
  return { found: found.map((f) => ({ name: f.name, value: f.value })), redacted: out + src.slice(last) };
}
async function protectMessage(vault, project, text) {
  const s = scanSecrets(text);
  if (!s.found.length) return { text: String(text ?? ""), saved: [], dropped: [], notice: "" };
  const saved = [], dropped = [];
  let out = s.redacted;
  for (const f of s.found) {
    try {
      const r = await vault.set(project, f.name, f.value, "detected");
      saved.push({ name: r.name, preview: r.preview });
    } catch (e) {
      dropped.push({ name: f.name, why: String(e.message) });
      out = out.split("{{secret:" + f.name + "}}").join("[secret removed: " + f.name + "]");
    }
  }
  const notice = [saved.length ? "Saved " + saved.length + " secret" + (saved.length > 1 ? "s" : "") + " for this project (" + saved.map((x) => x.name).join(", ") + "). The value was removed from your message and is never shown to the AI." : "", dropped.length ? dropped.length + " more could not be saved (" + dropped.map((x) => x.why).join("; ") + "), and was removed from your message." : ""].filter(Boolean).join(" ");
  return { text: out, saved, dropped, notice };
}

// functions/siteStudioRun.ts
var STAGES = ["understand", "inspect", "plan", "execute", "verify", "repair", "report"];
var MODES = {
  fast: { label: "Fast", note: "Small, targeted changes.", maxSteps: 8, maxRepairs: 1, plan: false },
  build: { label: "Build", note: "Complete implementation workflow.", maxSteps: 24, maxRepairs: 2, plan: true },
  think: { label: "Think", note: "More planning and reasoning before editing.", maxSteps: 24, maxRepairs: 2, plan: true, planFirst: true },
  repair: { label: "Repair", note: "Inspect logs, find bugs, patch, then verify.", maxSteps: 16, maxRepairs: 3, plan: true, startAt: "verify" }
};
var STEP_STATUS = /* @__PURE__ */ new Set(["running", "completed", "failed", "cancelled", "waiting"]);
var RUN_STATUS = /* @__PURE__ */ new Set(["queued", "running", "waiting", "completed", "failed", "cancelled"]);
var MAX_STEPS = 400;
var MAX_TEXT = 4e3;
var clip = (v, n = MAX_TEXT) => {
  const s = typeof v === "string" ? v : v == null ? "" : (() => {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  })();
  return s.length > n ? s.slice(0, n) + "\n[cut: " + (s.length - n) + " more characters]" : s;
};
var SECRET = /(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|tlm_sk_[A-Za-z0-9]+|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?[A-Za-z0-9_\-./+]{12,})/gi;
var known = [];
var setKnownSecrets = (values) => {
  known = (values || []).filter((v) => v && v.length >= 8);
};
function scrub(s) {
  let t2 = String(s ?? "");
  for (const v of known) if (t2.includes(v)) t2 = t2.split(v).join("[hidden]");
  const keep = [];
  t2 = t2.replace(/\{\{secret:[A-Z0-9_]+\}\}/g, (m) => {
    keep.push(m);
    return "" + (keep.length - 1) + "";
  });
  t2 = t2.replace(SECRET, "[hidden]");
  return t2.replace(/\u0001(\d+)\u0002/g, (_, i) => keep[+i]);
}
var safe = (v) => scrub(clip(v));
var rid = () => {
  const b = new Uint8Array(3);
  crypto.getRandomValues(b);
  return "r" + Date.now().toString(36) + Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
};
function create({ project, prompt, mode, model, files }) {
  const m = MODES[mode || ""] ? mode : "build";
  return {
    id: rid(),
    project: String(project || "").slice(0, 60),
    prompt: safe(prompt).slice(0, 4e3),
    mode: m,
    model: String(model || "").slice(0, 80),
    attachments: Array.isArray(files) ? files.slice(0, 10).map((x) => String(x).slice(0, 100)) : [],
    status: "queued",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    finishedAt: null,
    stage: "understand",
    stages: STAGES.map((s) => ({ id: s, status: "pending", startedAt: null, endedAt: null, note: "" })),
    plan: [],
    steps: [],
    checkpoint: null,
    files: {},
    verify: { builds: [], tests: [], problems: [] },
    repairs: 0,
    report: null,
    error: null,
    notice: void 0
  };
}
function setStage(run, id, status2, note) {
  if (!STAGES.includes(id)) throw new Error("unknown stage");
  const s = run.stages.find((x) => x.id === id), now = Date.now();
  if (status2 === "running" && !s.startedAt) s.startedAt = now;
  if ((status2 === "completed" || status2 === "failed" || status2 === "skipped") && !s.endedAt) s.endedAt = now;
  s.status = status2;
  if (note != null) s.note = safe(note).slice(0, 300);
  if (status2 === "running") run.stage = id;
  run.updatedAt = now;
  return run;
}
function setPlan(run, tasks) {
  run.plan = (Array.isArray(tasks) ? tasks : []).slice(0, 30).map((t2, i) => ({ id: "t" + (i + 1), title: scrub(String(t2?.title || t2 || "")).slice(0, 200), dependsOn: (Array.isArray(t2?.dependsOn) ? t2.dependsOn : []).filter((d) => /^t\d+$/.test(d)).slice(0, 8), status: "pending" })).filter((t2) => t2.title);
  run.updatedAt = Date.now();
  return run;
}
function editPlan(run, tasks) {
  if (run.status === "completed" || run.status === "cancelled" || run.status === "failed") throw new Error("this run has finished, so its plan cannot change");
  const done = new Map(run.plan.map((t2) => [t2.title, t2.status]));
  setPlan(run, tasks);
  for (const t2 of run.plan) if (done.get(t2.title) === "done") t2.status = "done";
  return run;
}
function markTask(run, id, status2) {
  const t2 = run.plan.find((x) => x.id === id);
  if (t2) t2.status = status2;
  run.updatedAt = Date.now();
  return run;
}
function openStep(run, { kind, title, tool, input, files }) {
  if (run.steps.length >= MAX_STEPS) throw new Error("this run reached the step limit (" + MAX_STEPS + ")");
  const st = { id: "s" + (run.steps.length + 1), stage: run.stage, kind: String(kind || "tool").slice(0, 20), title: scrub(title).slice(0, 160), tool: String(tool || "").slice(0, 60), input: safe(input), output: "", status: "running", startedAt: Date.now(), endedAt: null, ms: null, files: (files || []).map((x) => String(x).slice(0, 120)).slice(0, 10), error: null };
  run.steps.push(st);
  run.updatedAt = st.startedAt;
  return st;
}
function closeStep(run, step, { ok: ok2, output, error, files, status: status2 }) {
  const st = typeof step === "string" ? run.steps.find((x) => x.id === step) : step;
  if (!st) throw new Error("no such step");
  const now = Date.now();
  st.endedAt = now;
  st.ms = now - st.startedAt;
  st.status = status2 && STEP_STATUS.has(status2) ? status2 : ok2 === false ? "failed" : "completed";
  st.output = safe(output);
  if (error) st.error = safe(error).slice(0, 600);
  if (Array.isArray(files)) st.files = [.../* @__PURE__ */ new Set([...st.files, ...files.map((x) => String(x).slice(0, 120))])].slice(0, 10);
  run.updatedAt = now;
  return st;
}
function addBuild(run, r) {
  run.verify.builds.push({ at: Date.now(), cmd: String(r.cmd || "").slice(0, 200), code: r.code == null ? null : r.code, ok: !!r.ok, ms: r.ms || 0, output: safe(r.output) });
  run.verify.builds = run.verify.builds.slice(-10);
  return run;
}
function setProblems(run, list) {
  run.verify.problems = (list || []).slice(0, 100).map((p) => ({ file: String(p.file || "").slice(0, 120), line: p.line == null ? null : +p.line || null, severity: p.severity === "warning" ? "warning" : "error", message: scrub(p.message).slice(0, 300) }));
  return run;
}
function noteFiles(run, changes) {
  for (const c of changes || []) run.files[String(c.file).slice(0, 120)] = { status: c.status, added: c.added || 0, removed: c.removed || 0 };
  return run;
}
function finish(run, status2, report, error) {
  if (!RUN_STATUS.has(status2)) throw new Error("bad status");
  const now = Date.now();
  run.status = status2;
  run.finishedAt = now;
  run.updatedAt = now;
  for (const st of run.steps) if (st.status === "running") {
    st.status = status2 === "cancelled" ? "cancelled" : "failed";
    st.endedAt = now;
    st.ms = now - st.startedAt;
    if (!st.error) st.error = "stopped before it finished";
  }
  if (report) run.report = report;
  if (error) run.error = safe(error).slice(0, 600);
  return run;
}
function buildReport(run) {
  const files = Object.entries(run.files).map(([file, v]) => ({ file, ...v })), failedSteps = run.steps.filter((s) => s.status === "failed");
  const lastBuild = run.verify.builds[run.verify.builds.length - 1], lastTest = run.verify.tests[run.verify.tests.length - 1], errors = run.verify.problems.filter((p) => p.severity === "error");
  const unresolved = [...errors.slice(0, 10).map((p) => `${p.file}${p.line ? ":" + p.line : ""} ${p.message}`), ...lastBuild && !lastBuild.ok ? ["The last build failed (exit " + lastBuild.code + ")."] : [], ...lastTest && !lastTest.ok ? ["The last test run failed."] : []];
  return { changed: files.length, files, steps: { total: run.steps.length, failed: failedSteps.length }, verified: { build: lastBuild ? lastBuild.ok ? "passed" : "failed" : "not run", tests: lastTest ? lastTest.ok ? "passed" : "failed" : "not run", problems: errors.length }, repairs: run.repairs, unresolved };
}
var summary = (r) => ({ id: r.id, project: r.project, prompt: String(r.prompt).slice(0, 140), mode: r.mode, status: r.status, createdAt: r.createdAt, finishedAt: r.finishedAt, steps: (r.steps || []).length, changed: Object.keys(r.files || {}).length });

// functions/siteStudioEngine.ts
function diffLines(a, b) {
  const A = a.split("\n"), B = b.split("\n");
  if (A.length * B.length > 4e6) return { added: B.length, removed: A.length, hunks: [{ type: "too-big" }] };
  const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i2 = n - 1; i2 >= 0; i2--) for (let j2 = m - 1; j2 >= 0; j2--) L[i2][j2] = A[i2] === B[j2] ? L[i2 + 1][j2 + 1] + 1 : Math.max(L[i2 + 1][j2], L[i2][j2 + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      ops.push([" ", A[i], i + 1, j + 1]);
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) {
      ops.push(["-", A[i], i + 1, null]);
      i++;
    } else {
      ops.push(["+", B[j], null, j + 1]);
      j++;
    }
  }
  while (i < n) {
    ops.push(["-", A[i], i + 1, null]);
    i++;
  }
  while (j < m) {
    ops.push(["+", B[j], null, j + 1]);
    j++;
  }
  let added = 0, removed = 0;
  for (const o of ops) {
    if (o[0] === "+") added++;
    else if (o[0] === "-") removed++;
  }
  const keep = new Array(ops.length).fill(false);
  ops.forEach((o, k) => {
    if (o[0] !== " ") for (let x = Math.max(0, k - 2); x <= Math.min(ops.length - 1, k + 2); x++) keep[x] = true;
  });
  const hunks = [];
  let cur = null;
  ops.forEach((o, k) => {
    if (!keep[k]) {
      cur = null;
      return;
    }
    if (!cur) {
      cur = { oldStart: o[2] || 0, newStart: o[3] || 0, lines: [] };
      hunks.push(cur);
    }
    cur.lines.push({ t: o[0], s: o[1].slice(0, 300) });
  });
  return { added, removed, hunks: hunks.slice(0, 60) };
}
function compareFiles(before, after) {
  const out = [];
  for (const name of [.../* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const a = before[name], b = after[name];
    if (a === void 0) out.push({ file: name, status: "added", before: "", ...diffLines("", String(b)) });
    else if (b === void 0) out.push({ file: name, status: "removed", before: String(a), ...diffLines(String(a), "") });
    else if (a !== b) out.push({ file: name, status: "changed", before: String(a), ...diffLines(String(a), String(b)) });
  }
  return out;
}
async function problems(c, p) {
  const files = await c.store.allFiles(p), out = [];
  for (const [name, text] of Object.entries(files)) {
    if (/\.m?js$/i.test(name)) {
      try {
        new Function(text);
      } catch (e) {
        const m = String(e.message);
        if (!/import|export|await|module/.test(m)) out.push({ file: name, line: null, severity: "error", message: m.slice(0, 300), source: "parse" });
      }
    }
    if (/\.json$/i.test(name)) {
      try {
        JSON.parse(text);
      } catch (e) {
        out.push({ file: name, line: null, severity: "error", message: "Invalid JSON: " + String(e.message).slice(0, 200), source: "parse" });
      }
    }
  }
  const seen = new Set(out.map((x) => x.file + "|" + x.message));
  for (const msg of await check(c, p)) {
    if (/^script error/.test(msg.split(": ").slice(1).join(": "))) continue;
    const file = Object.keys(files).find((n) => msg.startsWith(n + ":") || msg.startsWith(n + " ")) || "";
    const key = file + "|" + msg;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ file, line: null, severity: /is used more than once/.test(msg) ? "warning" : "error", message: msg.slice(0, 300), source: "check" });
  }
  return out.slice(0, 100);
}
async function build(c, p) {
  const t0 = Date.now(), list = await problems(c, p), errors = list.filter((x) => x.severity === "error"), names = Object.keys(await c.store.allFiles(p));
  const out = [`Checked ${names.length} file(s): ${names.join(", ").slice(0, 300) || "(none)"}`, errors.length ? `${errors.length} error(s), ${list.length - errors.length} warning(s).` : `No errors${list.length ? ", " + list.length + " warning(s)" : ""}.`, ...list.slice(0, 20).map((x) => `${x.severity}: ${x.file}${x.line ? ":" + x.line : ""} ${x.message}`)];
  return { ok: errors.length === 0, cmd: "studio build check (static)", code: errors.length ? 1 : 0, ms: Date.now() - t0, output: out.join("\n"), problems: list, note: "Website Studio projects are static web files, so the build is a real parse and link check, not a bundler." };
}
var tests = (_p) => ({ available: false, ok: null, cmd: "", output: "Tests run in the PC Studio. The website Studio checks your files (scripts, JSON, links, ids) instead.", passed: null, failed: null, ms: 0 });
async function search(c, p, q2, limit = 60) {
  const needle = String(q2 || "").trim().toLowerCase();
  if (!needle) return [];
  const max = Math.max(1, Math.min(100, +limit || 60)), hits = [];
  for (const [file, text] of Object.entries(await c.store.allFiles(p))) {
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) if (lines[i].toLowerCase().includes(needle)) {
      hits.push({ file, line: i + 1, text: lines[i].trim().slice(0, 220) });
      if (hits.length >= max) return hits;
    }
  }
  return hits;
}
async function runDiff(c, cps, run) {
  if (!run.checkpoint) return { available: false, changes: [], note: "No checkpoint was saved for this run, so there is nothing to compare with." };
  const cp = await cps.load(run.project, run.checkpoint);
  if (!cp) return { available: false, changes: [], note: "The checkpoint is gone." };
  return { available: true, changes: compareFiles(cp.files, await c.store.allFiles(run.project)) };
}
async function revertRun(c, cps, run) {
  if (!run.checkpoint) throw new Error("This run has no checkpoint to go back to.");
  const cp = await cps.load(run.project, run.checkpoint);
  if (!cp) throw new Error("The checkpoint is gone.");
  await cps.save(run.project, 'Before restoring "' + cp.label + '"', await c.store.allFiles(run.project));
  await c.store.replaceFiles(run.project, cp.files);
  return { ok: true, files: Object.keys(cp.files).length };
}
async function revertFile(c, cps, run, file) {
  if (!run.checkpoint) throw new Error("This run has no checkpoint.");
  const cp = await cps.load(run.project, run.checkpoint);
  if (!cp) throw new Error("The checkpoint is gone.");
  const name = fileName(file);
  await cps.save(run.project, "Before reverting " + name, await c.store.allFiles(run.project));
  if (Object.prototype.hasOwnProperty.call(cp.files, name)) {
    await c.store.putFile(run.project, name, String(cp.files[name]));
    return { ok: true, text: "Put back " + name };
  }
  await c.store.delFile(run.project, name);
  return { ok: true, text: "Removed " + name + " (it did not exist before this run)" };
}
var decisionsOf = (run) => run.review || {};
var markReview = (run, file, decision) => {
  run.review = { ...decisionsOf(run), [file]: decision };
};
async function reviewList(c, cps, run) {
  const d = await runDiff(c, cps, run), done = decisionsOf(run);
  return { available: d.available, note: d.note || null, files: (d.changes || []).map((x) => ({ ...x, decision: done[x.file] || "pending" })) };
}
async function reviewAct(c, cps, run, action, file) {
  const l = await reviewList(c, cps, run);
  if (action === "accept" || action === "reject") {
    const name = String(file || ""), f = l.files.find((x) => x.file === name);
    if (!f) throw new Error("That file has no change to " + action + ".");
    if (action === "accept") {
      markReview(run, name, "accepted");
      return { ok: true, text: "Kept " + name };
    }
    const r = await revertFile(c, cps, run, name);
    markReview(run, name, "rejected");
    return r;
  }
  if (action === "accept-all" || action === "reject-all") {
    const pending = l.files.filter((x) => x.decision === "pending");
    for (const f of pending) {
      if (action === "reject-all") await revertFile(c, cps, run, f.file);
      markReview(run, f.file, action === "reject-all" ? "rejected" : "accepted");
    }
    return { ok: true, count: pending.length, text: (action === "reject-all" ? "Put back " : "Kept ") + pending.length + " file" + (pending.length === 1 ? "" : "s") };
  }
  throw new Error("Choose accept, reject, accept-all or reject-all.");
}
var EDIT_TOOLS = /* @__PURE__ */ new Set(["studio_write", "studio_patch", "studio_lines", "studio_delete"]);
var READ_TOOLS = /* @__PURE__ */ new Set(["studio_files", "studio_read", "studio_read_numbered", "studio_check", "studio_diagnose", "studio_search"]);
var TOOL_DOCS = {
  studio_files: "List the files in the project. args: {}",
  studio_read: 'Read one file. args: {"file": string}',
  studio_read_numbered: 'Read a file with line numbers, to edit it by line. args: {"file": string}',
  studio_write: 'Create or replace a whole file (use for new files). args: {"file": string, "content": string}',
  studio_patch: 'Change a spot in an existing file (preferred for edits). Spacing differences are forgiven. args: {"file": string, "find": string, "replace": string, "all": boolean}',
  studio_lines: 'Edit by line number. args: {"file": string, "from": number, "to": number, "text": string}',
  studio_delete: 'Delete one file. args: {"file": string}',
  studio_check: "Check the project for broken links, duplicate ids and script errors. args: {}",
  studio_search: 'Search every file for some text. args: {"query": string}',
  studio_db_status: "See whether the Pholama Database is on, its tables, size and rules. args: {}",
  studio_db_enable: "Turn the Pholama Database ON for this project (free, under 0.01 GB, built-in accounts). Only when the app really needs accounts or saved data. args: {}",
  studio_db_create_table: 'Create a table. Column types: text, number, boolean, date. args: {"name": string, "columns": [{"name": string, "type": string}]}',
  studio_db_insert: 'Add a row. args: {"table": string, "row": object}',
  studio_db_select: 'Read rows. args: {"table": string, "where": object, "limit": number}'
};
function makeTools({ c, extra = {} }) {
  const T = {
    studio_files: async (p) => (await c.store.listFiles(p)).map((f) => `${f.name} (${f.size} bytes)`).join("\n") || "(empty)",
    studio_read: (p, a) => readFile(c, p, a.file),
    studio_read_numbered: (p, a) => readNumbered(c, p, a.file),
    studio_write: async (p, a) => {
      const r = await writeFile(c, p, a.file, a.content);
      return (r.created ? "Created " : "Saved ") + r.name + " (" + r.size + " bytes)";
    },
    studio_patch: (p, a) => patchFile(c, p, a.file, a.find, a.replace, !!a.all),
    studio_lines: (p, a) => editLines(c, p, a.file, a.from, a.to, a.text),
    studio_delete: (p, a) => deleteFile(c, p, a.file),
    studio_check: async (p) => {
      const l = await check(c, p);
      return l.length ? l.join("\n") : "No problems found.";
    },
    studio_diagnose: async (p) => {
      const names = (await c.store.listFiles(p)).map((f) => f.name), pr = await problems(c, p);
      return names.length + " file(s): " + names.join(", ") + "\n" + (pr.length ? pr.map((x) => x.severity + ": " + x.file + " " + x.message).join("\n") : "No problems found.");
    },
    studio_search: async (p, a) => (await search(c, p, a.query, 30)).map((h) => `${h.file}:${h.line} ${h.text}`).join("\n") || "No matches."
  };
  for (const [name, fn] of Object.entries(extra)) T[name] = (_p, a) => fn(a);
  return { has: (n) => Object.prototype.hasOwnProperty.call(T, n), names: () => Object.keys(T), run: async (n, p, a) => {
    if (!Object.prototype.hasOwnProperty.call(T, n)) throw new Error("unknown tool " + n);
    try {
      return String(await T[n](p, a || {}));
    } catch (e) {
      return "Tool error: " + (e?.message || e);
    }
  } };
}
function parseTool(text, names) {
  const t2 = String(text || "");
  const okName = (n) => !names || names.includes(n);
  const tryJson = (raw) => {
    try {
      return JSON.parse(raw);
    } catch {
      try {
        return JSON.parse(raw.replace(/,\s*([}\]])/g, "$1"));
      } catch {
        return null;
      }
    }
  };
  const fn = /<function\s*=\s*([a-z_][a-z0-9_]*)>\s*([\s\S]*?)(?:<\/function>|$)/i.exec(t2);
  if (fn && okName(fn[1])) {
    const a2 = tryJson(fn[2].trim());
    if (a2 && typeof a2 === "object" && !Array.isArray(a2)) return { name: fn[1], args: a2 };
  }
  const m = /<tool(?:_call)?>([\s\S]*?)(?:<\/tool(?:_call)?>|$)/i.exec(t2) || /```(?:json)?\s*(\{[\s\S]*?"name"[\s\S]*?\})\s*```/.exec(t2);
  if (!m) return null;
  const j = tryJson(m[1].trim());
  if (!j || typeof j.name !== "string" || !okName(j.name)) return null;
  let a = j.args ?? j.arguments ?? {};
  if (typeof a === "string") a = tryJson(a) || {};
  if (typeof a !== "object" || Array.isArray(a)) return null;
  return { name: j.name, args: a };
}
var titleFor = (tool, a) => {
  const f = a?.file ? " " + a.file : "";
  return { studio_files: "Listing the files", studio_read: "Reading" + f, studio_read_numbered: "Reading" + f + " with line numbers", studio_check: "Checking the project", studio_diagnose: "Diagnosing the project", studio_patch: "Applying a patch to" + f, studio_lines: "Editing lines in" + f, studio_write: "Writing" + f, studio_delete: "Deleting" + f, studio_search: 'Searching for "' + String(a?.query || "").slice(0, 40) + '"' }[tool] || "Running " + tool;
};
var kindFor = (tool) => EDIT_TOOLS.has(tool) ? "edit" : READ_TOOLS.has(tool) ? "read" : "tool";
var clip2 = (s, n) => s.length > n ? s.slice(0, n) + "\u2026" : s;
var blank = () => ({ phase: "start", digest: "", msgs: [], steps: 0, finishedByModel: false, repairNo: 0, errorsBefore: 0, backup: null, fixSteps: 0 });
var isDone = (r) => ["completed", "failed", "cancelled"].includes(r.status);
async function advance(run, d) {
  if (isDone(run)) return run;
  const mode = MODES[run.mode] || MODES.build, { c, tools } = d;
  const cur = run.cursor || (run.cursor = blank());
  const persist = () => d.runs.save(run);
  const secretsClean = (t2) => c.secrets.scrub(run.project, t2);
  const callModel = async (msgs, o) => d.callModel(await Promise.all(msgs.map(async (m) => ({ ...m, content: await secretsClean(m.content) }))), o);
  const runTool = async (n, p, a) => secretsClean(await tools.run(n, p, a));
  const cancelled = async () => !!await d.cancelled?.();
  const outOfTime = () => !!d.deadline && Date.now() > d.deadline;
  setKnownSecrets(Object.values(await c.secrets.values(run.project)));
  const finishWith = async (status2, error) => {
    const rep = buildReport(run);
    if (status2 === "completed" && (rep.verified.build === "failed" || rep.verified.tests === "failed" || rep.verified.problems > 0)) {
      status2 = "failed";
      error = error || "The work finished, but verification still reports problems.";
    }
    finish(run, status2, rep, error);
    for (const s of run.stages) if (s.status === "running") setStage(run, s.id, status2 === "cancelled" ? "skipped" : "failed");
    cur.phase = "done";
    cur.msgs = [];
    cur.backup = null;
    await persist();
    return run;
  };
  const snapshot = () => c.store.allFiles(run.project);
  const change = async () => {
    try {
      return (await runDiff(c, d.checkpoints, run)).changes;
    } catch {
      return [];
    }
  };
  const names = tools.names();
  const verify = async () => {
    const b = openStep(run, { kind: "verify", title: "Running the build check", tool: "studio.build", input: { project: run.project } });
    await persist();
    const br = await build(c, run.project);
    addBuild(run, br);
    setProblems(run, br.problems);
    closeStep(run, b, { ok: br.ok, output: br.output, error: br.ok ? null : "Build check found errors" });
    const t2 = openStep(run, { kind: "verify", title: "Running tests", tool: "studio.tests", input: { project: run.project } });
    const tr = tests(run.project);
    closeStep(run, t2, { ok: true, output: tr.output, status: "completed" });
    await persist();
    return br;
  };
  try {
    if (await cancelled()) return finishWith("cancelled");
    if (run.status === "queued" || cur.phase === "start") run.status = "running";
    if (cur.phase === "start") {
      setStage(run, "understand", "running");
      await persist();
      if (!run.project) {
        setStage(run, "understand", "failed", "Pick a project first.");
        return finishWith("failed", "Pick a project first.");
      }
      try {
        projName(run.project);
        if (!await c.store.hasProject(run.project)) throw new Error('There is no project named "' + run.project + '".');
      } catch (e) {
        setStage(run, "understand", "failed", e.message);
        return finishWith("failed", e.message);
      }
      setStage(run, "understand", "completed", "Target project: " + run.project + ". Mode: " + mode.label + ".");
      await persist();
      try {
        run.checkpoint = await d.checkpoints.save(run.project, "Before run: " + clip2(run.prompt, 60), await snapshot());
      } catch {
        run.checkpoint = null;
      }
      setStage(run, "inspect", "running");
      await persist();
      for (const [tool, args] of [["studio_files", {}], ["studio_diagnose", {}]]) {
        const st = openStep(run, { kind: "read", title: titleFor(tool, args), tool, input: args });
        await persist();
        try {
          const out = await runTool(tool, run.project, args);
          closeStep(run, st, { ok: true, output: out });
          cur.digest += "\n## " + tool + "\n" + out.slice(0, 2500);
        } catch (e) {
          closeStep(run, st, { ok: false, error: "Could not read that.", output: "Could not read that." });
        }
      }
      setStage(run, "inspect", "completed", "Read the project files and its diagnostics.");
      cur.phase = "plan";
      await persist();
      return run;
    }
    if (cur.phase === "plan") {
      setStage(run, "plan", "running");
      await persist();
      if (mode.plan) {
        const st = openStep(run, { kind: "model", title: "Planning the changes", tool: "model.plan", input: run.prompt });
        await persist();
        let text = "";
        try {
          text = await callModel([{ role: "system", content: 'You plan work on a small web project. Reply with ONLY a JSON array of 2 to 8 short task titles, for example ["Fix the broken script link","Improve the dashboard layout"]. No other text.' }, { role: "user", content: "Request: " + run.prompt + "\nProject facts:" + cur.digest }]);
        } catch {
          closeStep(run, st, { ok: false, error: "The AI could not answer. Try again in a moment." });
          await persist();
          return finishWith("failed", "The AI could not plan this. Try again in a moment.");
        }
        let tasks = [];
        try {
          const m = /\[[\s\S]*\]/.exec(text);
          tasks = JSON.parse(m ? m[0] : text);
        } catch {
        }
        tasks = (Array.isArray(tasks) ? tasks : []).map((t2) => typeof t2 === "string" ? { title: t2 } : t2).filter((t2) => t2 && t2.title);
        const fallback = !tasks.length;
        if (fallback) tasks = [{ title: clip2(run.prompt, 120) }];
        setPlan(run, tasks.map((t2, i) => ({ title: t2.title, dependsOn: i ? ["t" + i] : [] })));
        closeStep(run, st, { ok: true, output: fallback ? "The model did not return a readable plan, so the request itself is the single task." : run.plan.map((t2) => t2.id + " " + t2.title).join("\n") });
      } else setPlan(run, [{ title: clip2(run.prompt, 120) }]);
      setStage(run, "plan", "completed", run.plan.length + " task(s).");
      const system = 'You are Pholama Studio, editing the project "' + run.project + '". Tools: ' + names.map((n) => n + " " + (TOOL_DOCS[n] || "")).join(" | ") + '\nCall ONE tool at a time as <tool_call>{"name":"studio_patch","arguments":{"file":"index.html","find":"...","replace":"..."}}</tool_call>. Read a file before you edit it. When every task is done, reply in plain words with no tool call.\n' + (await d.notes?.() || "") + "\nTasks:\n" + run.plan.map((t2) => "- " + t2.id + " " + t2.title).join("\n");
      cur.msgs = [{ role: "system", content: system }, { role: "user", content: run.prompt + "\n\nProject facts:" + cur.digest }];
      cur.phase = "execute";
      setStage(run, "execute", "running");
      await persist();
      return run;
    }
    if (cur.phase === "execute") {
      while (cur.steps < mode.maxSteps) {
        if (await cancelled()) return finishWith("cancelled");
        if (outOfTime()) {
          await persist();
          return run;
        }
        let reply;
        try {
          reply = await callModel(cur.msgs);
        } catch {
          return finishWith("failed", "The AI stopped answering. Try again in a moment.");
        }
        const call = parseTool(reply, names);
        if (!call) {
          cur.finishedByModel = true;
          cur.msgs.push({ role: "assistant", content: reply });
          break;
        }
        cur.steps++;
        const args = Object.assign({}, call.args || {});
        const st = openStep(run, { kind: kindFor(call.name), title: titleFor(call.name, args), tool: call.name, input: args, files: args.file ? [String(args.file)] : [] });
        await persist();
        let out, ok2 = true;
        try {
          out = await runTool(call.name, run.project, args);
          if (/^(Tool error|error|could not|no such|not found|nothing)/i.test(out) || /did not save it/i.test(out)) ok2 = false;
        } catch (e) {
          out = e.message;
          ok2 = false;
        }
        closeStep(run, st, { ok: ok2, output: out, error: ok2 ? null : out });
        cur.msgs.push({ role: "assistant", content: reply }, { role: "user", content: "[" + call.name + (ok2 ? " ok" : " failed") + "]\n" + out.slice(0, 2e3) + "\n[end]" });
        await persist();
      }
      const ch = await change();
      noteFiles(run, ch.map((x) => ({ file: x.file, status: x.status, added: x.added, removed: x.removed })));
      for (const t2 of run.plan) markTask(run, t2.id, ch.length ? "done" : "pending");
      setStage(run, "execute", ch.length ? "completed" : "failed", ch.length ? ch.length + " file(s) changed." : cur.finishedByModel ? "The model finished without changing any file." : "Reached the step limit without changing a file.");
      setStage(run, "verify", "running");
      cur.phase = "verify";
      await persist();
      return run;
    }
    if (cur.phase === "verify") {
      const v = await verify();
      setStage(run, "verify", v.ok ? "completed" : "failed", v.ok ? "Build check passed." : v.problems.filter((p) => p.severity === "error").length + " error(s) found.");
      if (!v.ok && cur.repairNo < mode.maxRepairs) {
        cur.phase = "repair";
        cur.fixSteps = 0;
        cur.backup = null;
      } else cur.phase = "report";
      await persist();
      return run;
    }
    if (cur.phase === "repair") {
      if (!cur.backup) {
        cur.repairNo++;
        run.repairs = cur.repairNo;
        setStage(run, "repair", "running", "Attempt " + cur.repairNo + " of " + mode.maxRepairs);
        const last = run.verify.builds[run.verify.builds.length - 1];
        cur.errorsBefore = run.verify.problems.filter((p) => p.severity === "error").length;
        cur.backup = await snapshot();
        cur.fixSteps = 0;
        const st = openStep(run, { kind: "repair", title: "Investigating errors (attempt " + cur.repairNo + ")", tool: "model.repair", input: String(last?.output || "").slice(0, 800) });
        cur.msgs.push({ role: "user", content: "[verification found real problems]\n" + String(last?.output || "").slice(0, 1500) + "\n[end]\nFix these exact problems with tools. Read the file first." });
        closeStep(run, st, { ok: true, output: "Sent the real error output to the model." });
        await persist();
        return run;
      }
      let more = true;
      while (cur.fixSteps < Math.min(6, mode.maxSteps)) {
        if (await cancelled()) return finishWith("cancelled");
        if (outOfTime()) {
          await persist();
          return run;
        }
        let reply;
        try {
          reply = await callModel(cur.msgs);
        } catch {
          more = false;
          break;
        }
        const call = parseTool(reply, names);
        if (!call) {
          cur.msgs.push({ role: "assistant", content: reply });
          more = false;
          break;
        }
        cur.fixSteps++;
        const args = Object.assign({}, call.args || {});
        const s2 = openStep(run, { kind: kindFor(call.name), title: (EDIT_TOOLS.has(call.name) ? "Fixing: " : "") + titleFor(call.name, args), tool: call.name, input: args, files: args.file ? [String(args.file)] : [] });
        await persist();
        let out, ok2 = true;
        try {
          out = await runTool(call.name, run.project, args);
          if (/^(Tool error|error|could not|no such|not found)/i.test(out) || /did not save it/i.test(out)) ok2 = false;
        } catch (e) {
          out = e.message;
          ok2 = false;
        }
        closeStep(run, s2, { ok: ok2, output: out, error: ok2 ? null : out });
        cur.msgs.push({ role: "assistant", content: reply }, { role: "user", content: "[" + call.name + (ok2 ? " ok" : " failed") + "]\n" + out.slice(0, 1500) + "\n[end]" });
        await persist();
      }
      void more;
      let v = await verify();
      const errorsAfter = v.problems.filter((p) => p.severity === "error").length;
      if (errorsAfter > cur.errorsBefore && cur.backup) {
        await c.store.replaceFiles(run.project, cur.backup);
        const rb = openStep(run, { kind: "repair", title: "Undid a fix that made things worse", tool: "rollback", input: { attempt: cur.repairNo } });
        closeStep(run, rb, { ok: true, output: "Errors went from " + cur.errorsBefore + " to " + errorsAfter + ", so the project was put back." });
        v = await verify();
      }
      cur.backup = null;
      if (!v.ok && cur.repairNo < mode.maxRepairs) {
      } else cur.phase = "report";
      await persist();
      return run;
    }
    if (cur.phase === "report") {
      const lastOk = run.verify.builds.length ? run.verify.builds[run.verify.builds.length - 1].ok : false;
      if (run.repairs) setStage(run, "repair", lastOk ? "completed" : "failed", (lastOk ? "Fixed after " : "Still failing after ") + run.repairs + " attempt(s).");
      else setStage(run, "repair", "skipped", "Nothing needed repairing.");
      const ch = await change();
      noteFiles(run, ch.map((x) => ({ file: x.file, status: x.status, added: x.added, removed: x.removed })));
      setStage(run, "report", "running");
      const clean = lastOk && ch.length > 0;
      setStage(run, "report", "completed", clean ? "Verified." : ch.length ? "Finished with open problems." : "No files were changed.");
      return finishWith(clean ? "completed" : "failed", clean ? null : ch.length ? "Verification still reports problems." : "The run ended without changing any file.");
    }
    return run;
  } catch {
    try {
      return await finishWith(await cancelled() ? "cancelled" : "failed", "Something went wrong while running this.");
    } catch {
      return run;
    }
  }
}

// functions/siteStudioDb.ts
var DB_LIMITS = {
  MAX_BYTES: 10 * 1024 * 1024,
  MAX_TABLES: 8,
  MAX_COLUMNS: 20,
  MAX_ROWS_PER_TABLE: 5e3,
  MAX_ROW_BYTES: 16 * 1024,
  MAX_ACCOUNTS: 500,
  SIGNIN_PER_WEEK: 10,
  WEEK_MS: 7 * 24 * 3600 * 1e3,
  BREAK_MS: 4 * 3600 * 1e3,
  PROJECT_SIGNIN_PER_WEEK: 200
};
var emptyDoc = () => ({ v: 1, enabled: false, tables: {}, accounts: [], seq: 1, signins: [] });
var COLUMN_TYPES = /* @__PURE__ */ new Set(["text", "number", "boolean", "date"]);
var size = (d) => new TextEncoder().encode(JSON.stringify(d)).length;
var DbError = class extends Error {
  code;
  retryAt;
  constructor(m, code = "error", retryAt) {
    super(m);
    this.code = code;
    this.retryAt = retryAt;
  }
};
var ident = (s, what) => {
  const n = String(s ?? "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,30}$/.test(n) || /^(accounts|__proto__|constructor|prototype)$/.test(n)) throw new DbError("A " + what + " name uses lowercase letters, numbers and underscores and starts with a letter.");
  return n;
};
var needAI = (by) => {
  if (by !== "ai") throw new DbError("Only the AI sets up the database. Ask it in the chat.", "ai-only");
};
var fits = (d) => {
  if (size(d) > DB_LIMITS.MAX_BYTES) throw new DbError("The database is full (limit 0.01 GB). Delete some rows first.", "full");
};
function enable(d, by) {
  needAI(by);
  d.enabled = true;
  return d;
}
function createTable(d, name, columns, by) {
  needAI(by);
  if (!d.enabled) throw new DbError("Turn the database on first.");
  const t2 = ident(name, "table");
  if (d.tables[t2]) throw new DbError("The table " + t2 + " already exists.");
  if (Object.keys(d.tables).length >= DB_LIMITS.MAX_TABLES) throw new DbError("At most " + DB_LIMITS.MAX_TABLES + " tables.");
  if (!Array.isArray(columns) || !columns.length) throw new DbError("Give the table at least one column.");
  if (columns.length > DB_LIMITS.MAX_COLUMNS) throw new DbError("At most " + DB_LIMITS.MAX_COLUMNS + " columns.");
  const cols = {};
  for (const c of columns) {
    const cn = ident(c?.name, "column");
    if (cn === "id") throw new DbError("id is added for you.");
    if (cols[cn]) throw new DbError("Duplicate column " + cn + ".");
    const ty = String(c.type || "text").toLowerCase();
    if (!COLUMN_TYPES.has(ty)) throw new DbError("Column type must be text, number, boolean or date.");
    cols[cn] = ty;
  }
  d.tables[t2] = { columns: cols, rows: [] };
  return { table: t2, columns: cols };
}
function coerce(ty, v) {
  if (v == null || v === "") return null;
  if (ty === "number") {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new DbError('"' + v + '" is not a number.');
    return n;
  }
  if (ty === "boolean") {
    if (v === true || v === "true" || v === 1) return true;
    if (v === false || v === "false" || v === 0) return false;
    throw new DbError('"' + v + '" is not true or false.');
  }
  if (ty === "date") {
    const t2 = new Date(v);
    if (isNaN(+t2)) throw new DbError('"' + v + '" is not a date.');
    return t2.toISOString();
  }
  return String(v).slice(0, 4e3);
}
function rowFrom(t2, obj) {
  const row = {};
  for (const [k, ty] of Object.entries(t2.columns)) row[k] = coerce(ty, obj?.[k]);
  for (const k of Object.keys(obj || {})) if (k !== "id" && !(k in t2.columns)) throw new DbError('There is no column "' + k + '" in this table.');
  if (new TextEncoder().encode(JSON.stringify(row)).length > DB_LIMITS.MAX_ROW_BYTES) throw new DbError("That row is too big.");
  return row;
}
var tbl = (d, name) => {
  const t2 = d.tables[ident(name, "table")];
  if (!t2) throw new DbError("No such table.");
  return t2;
};
function insert(d, name, obj) {
  if (!d.enabled) throw new DbError("The database is off for this project.");
  const t2 = tbl(d, name);
  if (t2.rows.length >= DB_LIMITS.MAX_ROWS_PER_TABLE) throw new DbError("This table is full (" + DB_LIMITS.MAX_ROWS_PER_TABLE + " rows).");
  const row = Object.assign({ id: d.seq++ }, rowFrom(t2, obj));
  t2.rows.push(row);
  return row;
}
function select(d, name, opts = {}) {
  const t2 = tbl(d, name);
  let rows = t2.rows;
  if (opts.where && typeof opts.where === "object") for (const [k, v] of Object.entries(opts.where)) {
    if (!(k in t2.columns) && k !== "id") throw new DbError('There is no column "' + k + '".');
    rows = rows.filter((r) => r[k] === v);
  }
  if (opts.orderBy && (opts.orderBy in t2.columns || opts.orderBy === "id")) {
    const k = opts.orderBy, dir = opts.desc ? -1 : 1;
    rows = rows.slice().sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir);
  }
  return rows.slice(0, Math.max(1, Math.min(200, +opts.limit || 50)));
}
var b64 = (u) => btoa(String.fromCharCode(...u));
var unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function hashPw(pw, salt) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 1e5 }, k, 256));
}
var same = (a, b) => {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a[i] ^ b[i];
  return x === 0;
};
var cleanEmail = (e) => {
  const s = String(e ?? "").trim().toLowerCase();
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(s) || s.length > 254) throw new DbError("Enter a valid email.");
  return s;
};
var cleanPw = (pw) => {
  const s = String(pw ?? "");
  if (s.length < 8) throw new DbError("A password needs at least 8 characters.");
  if (s.length > 200) throw new DbError("That password is too long.");
  return s;
};
async function signUp(d, email, password, extra) {
  if (!d.enabled) throw new DbError("The database is off for this project.");
  const e = cleanEmail(email), pw = cleanPw(password);
  if (d.accounts.some((a) => a.email === e)) throw new DbError("That email already has an account.");
  if (d.accounts.length >= DB_LIMITS.MAX_ACCOUNTS) throw new DbError("This project reached its account limit (" + DB_LIMITS.MAX_ACCOUNTS + ").");
  const salt = crypto.getRandomValues(new Uint8Array(16)), acct = { id: d.seq++, email: e, salt: b64(salt), hash: b64(await hashPw(pw, salt)), created: Date.now(), name: extra?.name ? String(extra.name).slice(0, 60) : "" };
  d.accounts.push(acct);
  return { id: acct.id, email: e, name: acct.name };
}
var wait = (ms) => {
  const m = Math.ceil(ms / 6e4);
  return m >= 60 ? Math.floor(m / 60) + " h " + m % 60 + " min" : m + " min";
};
async function signIn(d, email, password, now = Date.now()) {
  if (!d.enabled) throw new DbError("The database is off for this project.");
  const e = cleanEmail(email);
  d.signins = d.signins.filter((s) => now - s.t < DB_LIMITS.WEEK_MS);
  const mine = d.signins.filter((s) => s.e === e), until = d.breaks?.[e];
  if (until && now < until) throw new DbError("Too many sign-ins this week. Try again in " + wait(until - now) + ".", "break", until);
  if (d.signins.length >= DB_LIMITS.PROJECT_SIGNIN_PER_WEEK) throw new DbError("This project is getting a lot of sign-ins. Try again later.", "busy", now + DB_LIMITS.BREAK_MS);
  const a = d.accounts.find((x) => x.email === e);
  let good = false;
  if (a) good = same(await hashPw(String(password ?? ""), unb64(a.salt)), unb64(a.hash));
  else await hashPw("x", new Uint8Array(16));
  d.signins.push({ e, t: now, ok: good });
  if (d.signins.filter((s) => s.e === e).length >= DB_LIMITS.SIGNIN_PER_WEEK) d.breaks = Object.assign({}, d.breaks, { [e]: now + DB_LIMITS.BREAK_MS });
  return { good, account: good ? { id: a.id, email: a.email, name: a.name, signinsThisWeek: mine.length + 1, left: Math.max(0, DB_LIMITS.SIGNIN_PER_WEEK - (mine.length + 1)) } : null };
}
function deleteAccount(d, email) {
  const e = cleanEmail(email), n = d.accounts.length;
  d.accounts = d.accounts.filter((a) => a.email !== e);
  return { removed: n - d.accounts.length };
}
function status(d) {
  const bytes3 = size(d);
  return {
    enabled: d.enabled,
    usedBytes: bytes3,
    limitBytes: DB_LIMITS.MAX_BYTES,
    usedPercent: Math.min(100, Math.round(bytes3 / DB_LIMITS.MAX_BYTES * 1e3) / 10),
    accounts: d.accounts.length,
    accountLimit: DB_LIMITS.MAX_ACCOUNTS,
    tables: Object.entries(d.tables).map(([name, t2]) => ({ name, columns: t2.columns, rows: t2.rows.length })),
    rules: { signInsPerWeek: DB_LIMITS.SIGNIN_PER_WEEK, breakHours: DB_LIMITS.BREAK_MS / 36e5 }
  };
}
function promptNote(d) {
  const s = status(d);
  if (!s.enabled) return "The Pholama Database is OFF for this project. Turn it on only if the app needs accounts or saved data, and say why.";
  return "The Pholama Database is ON (under 0.01 GB). Tables: " + (s.tables.map((t2) => t2.name + "(" + Object.entries(t2.columns).map(([k, v]) => k + ":" + v).join(", ") + ")").join("; ") || "none yet") + ". Accounts are built in. Each account may sign in 10 times a week, then takes a 4 hour break, so never build auto-login loops.";
}

// functions/siteStudioSupabase.ts
function makeRest(url, key, f = fetch) {
  const H = { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
  return async (path, init = {}) => {
    const r = await f(url + "/rest/v1/" + path, { ...init, headers: { ...H, ...init.headers || {} } });
    const t2 = await r.text();
    let j = null;
    try {
      j = t2 ? JSON.parse(t2) : null;
    } catch {
    }
    if (!r.ok) throw new Error("database " + r.status);
    return j;
  };
}
var q = (s) => encodeURIComponent(s);
var bytes2 = (s) => new TextEncoder().encode(s).length;
function makeStore(rest, uid) {
  const U = "user_id=eq." + q(uid);
  return {
    async hasProject(p) {
      const r = await rest("pholama_site_projects?select=name&" + U + "&name=eq." + q(p) + "&limit=1");
      return !!r?.length;
    },
    async listProjects() {
      const r = await rest("pholama_site_projects?select=name,updated_at&" + U + "&order=updated_at.desc&limit=50");
      return (r || []).map((x) => ({ name: x.name, updated: Date.parse(x.updated_at) || 0 }));
    },
    async createProject(p) {
      await rest("pholama_site_projects", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id: uid, name: p }) });
    },
    async deleteProject(p) {
      await rest("pholama_site_projects?" + U + "&name=eq." + q(p), { method: "DELETE", headers: { Prefer: "return=minimal" } });
    },
    async listFiles(p) {
      const r = await rest("pholama_site_files?select=path,content&" + U + "&project=eq." + q(p) + "&limit=200");
      return (r || []).map((x) => ({ name: x.path, size: bytes2(x.content || "") }));
    },
    async getFile(p, f) {
      const r = await rest("pholama_site_files?select=content&" + U + "&project=eq." + q(p) + "&path=eq." + q(f) + "&limit=1");
      return r?.length ? String(r[0].content ?? "") : null;
    },
    async putFile(p, f, content) {
      await rest("pholama_site_files?on_conflict=user_id,project,path", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ user_id: uid, project: p, path: f, content, updated_at: (/* @__PURE__ */ new Date()).toISOString() }) });
      await rest("pholama_site_projects?" + U + "&name=eq." + q(p), { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ updated_at: (/* @__PURE__ */ new Date()).toISOString() }) });
    },
    async delFile(p, f) {
      await rest("pholama_site_files?" + U + "&project=eq." + q(p) + "&path=eq." + q(f), { method: "DELETE", headers: { Prefer: "return=minimal" } });
    },
    async allFiles(p) {
      const r = await rest("pholama_site_files?select=path,content&" + U + "&project=eq." + q(p) + "&limit=200");
      return Object.fromEntries((r || []).map((x) => [x.path, String(x.content ?? "")]));
    },
    async replaceFiles(p, files) {
      const have = await rest("pholama_site_files?select=path&" + U + "&project=eq." + q(p) + "&limit=200");
      const gone = (have || []).map((x) => x.path).filter((n) => !(n in files));
      for (const n of gone) await rest("pholama_site_files?" + U + "&project=eq." + q(p) + "&path=eq." + q(n), { method: "DELETE", headers: { Prefer: "return=minimal" } });
      const rows = Object.entries(files).map(([path, content]) => ({ user_id: uid, project: p, path, content, updated_at: (/* @__PURE__ */ new Date()).toISOString() }));
      if (rows.length) await rest("pholama_site_files?on_conflict=user_id,project,path", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
    }
  };
}
async function sealKey(master, uid, project) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(master), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("pholama-site-secrets-v1"), info: new TextEncoder().encode(uid + "|" + project) }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
var b642 = (u) => btoa(String.fromCharCode(...u));
var unb642 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function seal(master, uid, project, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sealKey(master, uid, project), new TextEncoder().encode(value)));
  return b642(iv) + "." + b642(ct);
}
async function unseal(master, uid, project, sealed) {
  const [iv, ct] = sealed.split(".");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb642(iv) }, await sealKey(master, uid, project), unb642(ct)));
}
function makeVault(rest, uid, master) {
  if (!master || master.length < 16) throw new Error("secret sealing is not configured");
  const U = "user_id=eq." + q(uid);
  const rows = async (p) => await rest("pholama_site_secrets?select=name,sealed,preview,source&" + U + "&project=eq." + q(p) + "&order=created_at.asc&limit=20") || [];
  const vault = {
    async list(p) {
      return (await rows(p)).map((r) => ({ name: r.name, preview: r.preview, source: r.source }));
    },
    async set(p, name, value, source) {
      const n = cleanSecretName(name), v = String(value ?? "");
      if (!v.trim()) throw new Error("The value is empty.");
      if (/[\r\n\0]/.test(v)) throw new Error("A secret value must be on one line.");
      if (v.length > 4e3) throw new Error("That value is too long.");
      const have = await rows(p), has = have.some((r) => r.name === n);
      if (!has && have.length >= LIMITS.MAX_SECRETS) throw new Error("A project can hold " + LIMITS.MAX_SECRETS + " secrets. Delete one first.");
      const sealed = await seal(master, uid, p, v), preview = maskValue(v);
      await rest("pholama_site_secrets?on_conflict=user_id,project,name", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ user_id: uid, project: p, name: n, sealed, preview, source }) });
      return { name: n, preview, replaced: has };
    },
    async remove(p, name) {
      const n = cleanSecretName(name), had = (await rows(p)).some((r) => r.name === n);
      if (had) await rest("pholama_site_secrets?" + U + "&project=eq." + q(p) + "&name=eq." + q(n), { method: "DELETE", headers: { Prefer: "return=minimal" } });
      return had;
    },
    async values(p) {
      const out = {};
      for (const r of await rows(p)) {
        try {
          out[r.name] = await unseal(master, uid, p, r.sealed);
        } catch {
        }
      }
      return out;
    },
    async scrub(p, text) {
      let t2 = String(text ?? "");
      for (const [k, v] of Object.entries(await vault.values(p))) if (v.length >= 8) t2 = t2.split(v).join("{{secret:" + k + "}}");
      return t2;
    }
  };
  return vault;
}
var rid2 = () => {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
};
function makeCheckpoints(rest, uid) {
  const U = "user_id=eq." + q(uid);
  return {
    async save(p, label, files) {
      const id = "c" + Date.now().toString(36) + rid2();
      await rest("pholama_site_checkpoints", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ id, user_id: uid, project: p, label: String(label).slice(0, 120), files }) });
      const old = await rest("pholama_site_checkpoints?select=id&" + U + "&project=eq." + q(p) + "&order=created_at.desc&offset=30&limit=50");
      for (const o of old || []) await rest("pholama_site_checkpoints?" + U + "&id=eq." + q(o.id), { method: "DELETE", headers: { Prefer: "return=minimal" } });
      return id;
    },
    async load(p, id) {
      const r = await rest("pholama_site_checkpoints?select=label,files&" + U + "&project=eq." + q(p) + "&id=eq." + q(id) + "&limit=1");
      return r?.length ? { label: r[0].label, files: r[0].files || {} } : null;
    },
    async list(p) {
      const r = await rest("pholama_site_checkpoints?select=id,label,created_at&" + U + "&project=eq." + q(p) + "&order=created_at.desc&limit=30");
      return (r || []).map((x) => ({ id: x.id, label: x.label, createdAt: Date.parse(x.created_at) || 0 }));
    }
  };
}
function makeRuns(rest, uid) {
  const U = "user_id=eq." + q(uid);
  return {
    async save(run) {
      await rest("pholama_site_runs?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ id: run.id, user_id: uid, project: run.project, status: run.status, data: run, updated_at: (/* @__PURE__ */ new Date()).toISOString() }) });
    },
    async load(id) {
      const r = await rest("pholama_site_runs?select=data&" + U + "&id=eq." + q(id) + "&limit=1");
      return r?.length ? r[0].data : null;
    },
    async list(project) {
      const r = await rest("pholama_site_runs?select=data&" + U + (project ? "&project=eq." + q(project) : "") + "&order=created_at.desc&limit=100");
      return (r || []).map((x) => x.data);
    },
    async remove(id) {
      await rest("pholama_site_runs?" + U + "&id=eq." + q(id), { method: "DELETE", headers: { Prefer: "return=minimal" } });
    },
    // Only one request may advance a run at a time: a lease stored on the run itself, compare-and-set on the update time.
    async lease(id, ms) {
      const r = await rest("pholama_site_runs?select=data,updated_at&" + U + "&id=eq." + q(id) + "&limit=1");
      if (!r?.length) return false;
      const d = r[0].data || {}, until = Number(d.leaseUntil || 0);
      if (until > Date.now()) return false;
      const upd = await rest("pholama_site_runs?" + U + "&id=eq." + q(id) + "&updated_at=eq." + q(r[0].updated_at), { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ data: { ...d, leaseUntil: Date.now() + ms }, updated_at: (/* @__PURE__ */ new Date()).toISOString() }) });
      return Array.isArray(upd) && upd.length === 1;
    }
  };
}
function makeDbStore(rest, uid) {
  const U = "user_id=eq." + q(uid);
  return {
    async load(p) {
      const r = await rest("pholama_site_db?select=data&" + U + "&project=eq." + q(p) + "&limit=1");
      return r?.length ? Object.assign(emptyDoc(), r[0].data) : emptyDoc();
    },
    async save(p, d) {
      await rest("pholama_site_db?on_conflict=user_id,project", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ user_id: uid, project: p, data: d, updated_at: (/* @__PURE__ */ new Date()).toISOString() }) });
    }
  };
}

// functions/siteStudioRoutes.ts
var DAILY_RUNS = 12;
var SLICE_MS = 4e4;
var MODEL = "qwen-coder";
var ok = (body, status2 = 200) => ({ status: status2, body });
var err = (m, status2 = 400, code) => ({ status: status2, body: code ? { error: m, code } : { error: m } });
var show = (e) => {
  const m = String(e?.message || "");
  return /^(database|fetch|TypeError|ReferenceError|Syntax|Unexpected|Failed|network|ECONN|HTTP|Deno)/i.test(m) || /supabase|postgres|relation|free\.ai|sql|stack|at\s+\S+\s+\(/i.test(m) ? "Something went wrong. Try again in a moment." : m || "Something went wrong.";
};
function capabilities() {
  return {
    modes: Object.entries(MODES).map(([id, m]) => ({ id, label: m.label, note: m.note, maxSteps: m.maxSteps, maxRepairs: m.maxRepairs })),
    models: [{ id: MODEL, name: "Pholama cloud agent", tools: true, coding: true, reasoning: false }],
    toolCalling: true,
    terminal: { available: false, note: "The website Studio has no terminal. The PC Studio does." },
    build: { available: true, note: "Website Studio projects are static web files. The build is a real parse and link check." },
    tests: { available: false, note: "Test files run in the PC Studio. The website checks scripts, JSON, links and ids instead." },
    limits: { projects: LIMITS.MAX_PROJECTS, files: LIMITS.MAX_FILES, secrets: LIMITS.MAX_SECRETS, runsPerDay: DAILY_RUNS },
    site: true,
    noStream: true
  };
}
function dbTools(project, dbs) {
  const withDoc = async (fn) => {
    const doc = await dbs.load(project);
    const out = await fn(doc);
    fits(doc);
    await dbs.save(project, doc);
    return out;
  };
  const j = (v) => typeof v === "string" ? v : JSON.stringify(v);
  return {
    studio_db_status: async () => {
      const s = status(await dbs.load(project));
      return j({ ...s, note: promptNote(await dbs.load(project)) });
    },
    studio_db_enable: (_a) => withDoc((doc) => {
      enable(doc, "ai");
      return "The database is on (free, under 0.01 GB). Accounts are built in. Rule to respect: each account can sign in 10 times a week, then takes a 4 hour break, so never build auto-login or retry loops. Create tables with studio_db_create_table.";
    }),
    studio_db_create_table: (a) => withDoc((doc) => j(createTable(doc, a?.name, a?.columns, "ai"))),
    studio_db_insert: (a) => withDoc((doc) => j(insert(doc, a?.table, a?.row))),
    studio_db_select: async (a) => j(select(await dbs.load(project), a?.table, { where: a?.where, limit: a?.limit }))
  };
}
async function handle(req, d) {
  const { method, path: seg, query, body } = req;
  const store = makeStore(d.rest, d.uid), vault = makeVault(d.rest, d.uid, d.master), c = { store, secrets: vault };
  const runs = makeRuns(d.rest, d.uid), cps = makeCheckpoints(d.rest, d.uid), dbs = makeDbStore(d.rest, d.uid);
  const now = d.now || Date.now;
  const own = async (p) => {
    const n = projName(p);
    if (!await store.hasProject(n)) throw new Error('There is no project named "' + n + '".');
    return n;
  };
  try {
    if (seg[0] === "capabilities" || !seg.length) return ok(capabilities());
    if (seg[0] === "dashboard" && method === "GET") {
      const list = await store.listProjects(), out = [];
      for (const p of list) {
        const files = await store.listFiles(p.name);
        const rs = await runs.list(p.name);
        const last = rs[0];
        out.push({ name: p.name, files: files.length, bytes: files.reduce((n, f) => n + f.size, 0), updated: p.updated, lastRun: last ? { id: last.id, status: last.status, prompt: String(last.prompt).slice(0, 80), at: last.createdAt } : null, running: rs.some((r) => !isDone(r)) });
      }
      return ok({ projects: out });
    }
    if (seg[0] === "resolve" && method === "POST") {
      const t2 = String(body?.text || "").toLowerCase(), list = await store.listProjects();
      const hit = list.filter((p) => t2.includes(p.name));
      return ok(hit.length === 1 ? { status: "found", project: hit[0].name } : hit.length > 1 ? { status: "ambiguous", candidates: hit.map((h) => h.name), message: "Which project do you mean?" } : { status: "none", message: list.length ? "I could not tell which project you mean. Pick one." : "You have no projects yet. Describe what to build and I will create one." });
    }
    if (seg[0] === "projects") {
      if (!seg[1] && method === "GET") return ok({ projects: await store.listProjects() });
      if (!seg[1] && method === "POST") return ok(await createProject(c, body?.name));
      const name = await own(seg[1]);
      if (!seg[2] && method === "GET") {
        const all = await store.allFiles(name);
        return ok({ name, files: Object.entries(all).sort(([a], [b]) => a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b)).map(([n, content]) => ({ name: n, size: new TextEncoder().encode(content).length, content })) });
      }
      if (!seg[2] && method === "DELETE") {
        await store.deleteProject(name);
        return ok({ ok: true, text: "Deleted " + name });
      }
      if (seg[2] === "tree" && method === "GET") {
        const fs = await store.listFiles(name);
        const dirs = /* @__PURE__ */ new Set();
        for (const f of fs) {
          const parts = f.name.split("/");
          for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
        }
        return ok({ files: fs, dirs: [...dirs].sort() });
      }
      if (seg[2] === "file" && method === "PUT") return ok(await writeFile(c, name, body?.file, body?.content));
      if (seg[2] === "file" && method === "DELETE") return ok({ ok: true, text: await deleteFile(c, name, body?.file) });
      if (seg[2] === "folder" && method === "POST") return ok({ ok: true, text: "Folders appear when a file is saved inside them." });
      if (seg[2] === "preview" && method === "GET") return ok({ files: await store.allFiles(name) });
    }
    if (seg[0] === "secrets" && seg[1]) {
      const name = await own(seg[1]);
      if (method === "GET" && !seg[2]) return ok({ secrets: await vault.list(name), max: LIMITS.MAX_SECRETS });
      if (method === "POST" && !seg[2]) return ok(Object.assign({ ok: true }, await vault.set(name, body?.name, body?.value, "manual")));
      if (method === "DELETE" && seg[2]) return ok({ removed: await vault.remove(name, seg[2]) });
    }
    if (seg[0] === "db" && seg[1]) {
      const name = await own(seg[1]);
      const doc = await dbs.load(name);
      if (method === "GET" && !seg[2]) return ok(status(doc));
      if (method === "GET" && seg[2] === "rows" && seg[3]) return ok({ rows: select(doc, seg[3], { limit: +(query.get("limit") || 50) }) });
      if (method === "DELETE" && seg[2] === "account" && seg[3]) {
        const r = deleteAccount(doc, seg[3]);
        await dbs.save(name, doc);
        return ok(r);
      }
      if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") return err("Only the AI sets up the database. Ask it in the chat.", 403, "ai-only");
    }
    if (seg[0] === "runs" && !seg[1] && method === "GET") return ok({ runs: (await runs.list(query.get("project") || "")).map(summary) });
    if (seg[0] === "runs" && !seg[1] && method === "POST") {
      let prompt = String(body?.prompt || "").trim();
      if (prompt.length < 3) return err("Describe the task first.");
      if (prompt.length > 4e3) return err("That prompt is too long (max 4000 characters).");
      const mode = MODES[body?.mode] ? body.mode : "build";
      let project2 = String(body?.project || "").trim();
      if (body?.newProject) project2 = (await createProject(c, String(body.newProject))).name;
      if (!project2) return err("Pick a project, or name a new one.");
      if (!await store.hasProject(projName(project2))) project2 = (await createProject(c, project2)).name;
      project2 = await own(project2);
      const active = (await runs.list(project2)).find((r) => !isDone(r) && now() - (r.updatedAt || 0) < 5 * 6e4);
      if (active) return err("This project already has a run working. Wait for it to finish or stop it.", 409);
      if (!await d.spend(d.uid, 1)) return err("You used all " + DAILY_RUNS + " AI runs for today. They come back tomorrow.", 429, "limit");
      const prot = await protectMessage(vault, project2, prompt);
      prompt = prot.text;
      const run = create({ project: project2, prompt, mode, model: MODEL, files: body?.attachments });
      if (prot.notice) run.notice = prot.notice;
      await runs.save(run);
      return ok({ id: run.id, status: "queued" }, 202);
    }
    if (seg[0] === "runs" && seg[1]) {
      const id = seg[1];
      if (!/^r[a-z0-9]{6,20}$/.test(id)) return err("No such run.", 404);
      const run = await runs.load(id);
      if (!run) return err("No such run.", 404);
      if (!seg[2] && method === "GET") {
        if (!isDone(run) && run.status !== "waiting" && await runs.lease(id, SLICE_MS + 15e3)) {
          const fresh = await runs.load(id) || run;
          const deadline = now() + SLICE_MS;
          const deps = { c, checkpoints: cps, runs: { save: (r) => runs.save(r) }, callModel: d.callModel, tools: makeTools({ c, extra: dbTools(fresh.project, dbs) }), deadline, notes: async () => promptNote(await dbs.load(fresh.project)), cancelled: async () => !!(await runs.load(id))?.cancelRequested };
          const out = await advance(fresh, deps);
          out.leaseUntil = 0;
          const latest = await runs.load(id);
          if (latest && latest.cancelRequested) out.cancelRequested = true;
          await runs.save(out);
          return ok({ run: out, active: !isDone(out) });
        }
        return ok({ run, active: !isDone(run) });
      }
      if (!seg[2] && method === "DELETE") {
        if (!isDone(run)) return err("Stop the run first.", 409);
        await runs.remove(id);
        return ok({ ok: true });
      }
      if (seg[2] === "cancel" && method === "POST") {
        if (isDone(run)) return ok({ ok: false });
        run.cancelRequested = true;
        await runs.save(run);
        return ok({ ok: true });
      }
      if (seg[2] === "plan" && method === "PUT") {
        if (!isDone(run) && run.status === "running") return err("The plan is locked while the run is working.", 409);
        editPlan(run, body?.tasks || []);
        await runs.save(run);
        return ok({ run });
      }
      if (seg[2] === "diff" && method === "GET") return ok(await runDiff(c, cps, run));
      if (seg[2] === "review" && method === "GET") return ok(await reviewList(c, cps, run));
      if (seg[2] === "review" && method === "POST") {
        if (!isDone(run)) return err("Wait for the run to finish, or stop it first.", 409);
        let out;
        try {
          out = await reviewAct(c, cps, run, String(body?.action || ""), body?.file);
        } catch (e) {
          return err(String(e.message || "That did not work."), 400);
        }
        await runs.save(run);
        return ok({ ...out, review: await reviewList(c, cps, run) });
      }
      if (seg[2] === "revert" && method === "POST") {
        if (!isDone(run)) return err("Stop the run first.", 409);
        return ok(body?.file ? await revertFile(c, cps, run, body.file) : await revertRun(c, cps, run));
      }
    }
    const project = query.get("project") || "";
    if (seg[0] === "search" && method === "GET") return ok({ hits: await search(c, await own(project), query.get("q") || "", +(query.get("limit") || 60)) });
    if (seg[0] === "problems" && method === "GET") return ok({ problems: await problems(c, await own(project)) });
    if (seg[0] === "build" && method === "POST") return ok(await build(c, await own(body?.project)));
    if (seg[0] === "tests" && method === "POST") {
      await own(body?.project);
      return ok(tests());
    }
    return err("Not found.", 404);
  } catch (e) {
    return err(show(e), /no project named|no such/i.test(String(e?.message)) ? 404 : 400);
  }
}

// functions/agentsCore.ts
var SELF_HOSTED = /* @__PURE__ */ new Set(["qwen7b", "qwen-coder", "qwen3-coder", "qwen3-8b", "mistral", "deepseek-r1", "deepseek-r1-7b", "kokoro", "whisper", "madlad", "rmbg", "triposr", "trellis2-4b", "got-ocr2", "paddleocr-vl", "unlimited-ocr", "tesseract", "qwen25-vl", "qwen-vl", "moondream2", "ace-step", "marigold-depth", "qwen-image-edit", "bge-m3"]);
var isSelfHosted = (model) => typeof model === "string" && SELF_HOSTED.has(model) && !model.includes("/");

// functions/siteStudioSelfcheck.ts
var hex = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("");
var t = async (fn) => {
  try {
    return await fn();
  } catch (e) {
    return "ERR:" + String(e.message).slice(0, 80);
  }
};
async function selfcheck() {
  const out = {};
  out.names = await Promise.all(["index.html", "../x", ".env", "a/b.js", "x.exe", "a b.css", "a//b.js", "sub/dir/ok.json", "A.TXT"].map((n) => t(() => fileName(n))));
  out.proj = await Promise.all(["Shop", " My Site! ", "", "...", "a".repeat(80)].map((n) => t(() => projName(n))));
  const cases = ["API_KEY=abcd1234efgh5678\nSECRET_KEY=zyxw9876vuts5432\nDEBUG=true", '{"apiKey": "abcd1234efgh5678ijkl", "password": "correct-horse-battery"}', 'curl -H "Authorization: Bearer ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8" x', "my password is hunter2hunter2 ok", 'export OPENAI_API_KEY="sk-proj-Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2Rr1Qq0Pp9Oo8Nn7"', "TOKEN=process.env.TOKEN", "const token = getToken();", "API_KEY=your_api_key_here", "AUTH=true", "I love api keys"];
  out.scan = cases.map((c2) => {
    const r = scanSecrets(c2);
    return r.redacted + "|" + r.found.map((f) => f.name).join(",");
  });
  const rep = (ch, n) => ch.repeat(n);
  out.edge = [["ghp_", 29], ["ghp_", 30], ["gsk_", 39], ["gsk_", 40], ["sk-ant-", 29], ["sk-ant-", 30], ["re_", 19], ["re_", 20], ["sk_live_", 19], ["sk_live_", 20], ["AKIA", 15], ["AKIA", 16], ["xoxb-", 19], ["xoxb-", 20], ["sb_secret_", 19], ["sb_secret_", 20], ["sk-", 31], ["sk-", 32]].map(([pre, n]) => {
    const r = scanSecrets("x " + pre + rep(pre === "AKIA" ? "A" : "a", n) + " y");
    return pre + n + ":" + r.found.map((f) => f.name).join(",");
  }).concat(["PASSWORD=1234567", "PASSWORD=12345678", "password: abcdefghijk", "password: abcdefghijkl", "SECRET=true1234", "TOKEN=a.b.c.d.e1"].map((c2) => c2 + ":" + scanSecrets(c2).found.length));
  out.limits = JSON.stringify(LIMITS) + JSON.stringify(DB_LIMITS);
  out.secretName = await Promise.all(["openai key", "9lives", "PATH", "ok_name", "x".repeat(60)].map((n) => t(() => cleanSecretName(n))));
  out.mask = [maskValue("abcdefghij"), maskValue("short")];
  const files = { "e.js": "function go() {\n    let x = 1;\n    return x;\n}\n", "dup.js": "a();\na();\n" };
  const store = { async hasProject() {
    return true;
  }, async listProjects() {
    return [];
  }, async createProject() {
  }, async deleteProject() {
  }, async listFiles() {
    return Object.entries(files).map(([name, c2]) => ({ name, size: c2.length }));
  }, async getFile(_p, f) {
    return f in files ? files[f] : null;
  }, async putFile(_p, f, c2) {
    files[f] = c2;
  }, async delFile(_p, f) {
    delete files[f];
  }, async allFiles() {
    return { ...files };
  }, async replaceFiles() {
  } };
  const c = { store, secrets: { async scrub(_p, s) {
    return s;
  }, async values() {
    return {};
  }, async list() {
    return [];
  }, async set() {
    return { name: "", preview: "", replaced: false };
  }, async remove() {
    return false;
  } } };
  out.edit = [await t(() => patchFile(c, "p", "e.js", "let x = 1;", "let x = 2;")), await t(() => patchFile(c, "p", "e.js", "return x;   ", "return x * 2;")), await t(() => patchFile(c, "p", "dup.js", "a();", "b();")), await t(() => patchFile(c, "p", "dup.js", "a();", "b();", true)), await t(() => patchFile(c, "p", "e.js", "return x * 2;", "return x * ;")), files["e.js"]];
  out.problems = await t(async () => {
    files["index.html"] = '<a href="nope.html">x</a><div id="a"></div><div id="a"></div>';
    return (await check(c, "p")).join("|");
  });
  const T0 = Date.UTC(2026, 9, 11, 9, 0, 0), H = 36e5;
  const doc = emptyDoc();
  enable(doc, "ai");
  await signUp(doc, "kim@example.com", "passw0rd-ok");
  const seen = [];
  for (let i = 0; i < 11; i++) {
    try {
      const r = await signIn(doc, "kim@example.com", "passw0rd-ok", T0 + i * 6e4);
      seen.push(r.good ? "ok" + r.account.left : "no");
    } catch (e) {
      seen.push(e.code);
    }
  }
  out.signins = seen.join(",");
  out.after4h = await t(async () => (await signIn(doc, "kim@example.com", "passw0rd-ok", T0 + 4 * H + 11 * 6e4)).good);
  out.hash = await t(async () => {
    const d3 = emptyDoc();
    enable(d3, "ai");
    await signUp(d3, "a@b.co", "known-password-1");
    d3.accounts[0].salt = btoa(String.fromCharCode(...new Uint8Array(16).fill(7)));
    const salt = new Uint8Array(16).fill(7);
    const k = await crypto.subtle.importKey("raw", new TextEncoder().encode("known-password-1"), "PBKDF2", false, ["deriveBits"]);
    const want = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 1e5 }, k, 256))));
    d3.accounts[0].hash = want;
    return (await signIn(d3, "a@b.co", "known-password-1", Date.now())).good;
  });
  out.aiOnly = await t(() => enable(emptyDoc(), "user"));
  out.dbTypes = await t(() => {
    const d2 = emptyDoc();
    enable(d2, "ai");
    createTable(d2, "notes", [{ name: "title" }, { name: "n", type: "number" }], "ai");
    return JSON.stringify(insert(d2, "notes", { title: "x", n: "3" }));
  });
  const s1 = await seal("master-key-for-selfcheck-0123456789", "u1", "shop", "sk-live-secret-value-123");
  out.seal = [await t(() => unseal("master-key-for-selfcheck-0123456789", "u1", "shop", s1)), await t(() => unseal("master-key-for-selfcheck-0123456789", "u2", "shop", s1)), await t(() => unseal("master-key-for-selfcheck-0123456789", "u1", "other", s1)), await t(() => unseal("another-master-key-for-selfcheck-99", "u1", "shop", s1)), s1.includes("secret-value")].map((x) => typeof x === "string" && x.startsWith("ERR") ? "ERR" : x);
  const run = create({ project: "shop", prompt: "a ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1", mode: "build", model: "m" });
  setPlan(run, ["one", { title: "two", dependsOn: ["t1"] }]);
  const st = openStep(run, { title: "x", tool: "studio_read", input: { f: 1 } });
  closeStep(run, st, { ok: false, error: "bad" });
  noteFiles(run, [{ file: "a.js", status: "changed", added: 2, removed: 1 }]);
  addBuild(run, { ok: true, code: 0, output: "fine" });
  out.run = JSON.stringify({ prompt: run.prompt, stages: run.stages.map((s) => s.id), plan: run.plan.map((p) => p.id + p.title + p.dependsOn.join()), report: buildReport(run) });
  out.parse = [parseTool('<tool_call>{"name":"studio_read","arguments":{"file":"a"}}</tool_call>'), parseTool('<tool_call>{"name":"studio_read","args":{"file":"a",}}'), parseTool('<function=studio_read>{"file":"a"}</function>'), parseTool('<tool_call>{"name":"rm","arguments":{}}</tool_call>', ["studio_read"]), parseTool("all done")].map((x) => x ? x.name + ":" + JSON.stringify(x.args) : null);
  out.diff = JSON.stringify(diffLines("a\nb\nc\nd", "a\nB\nc\nd\ne"));
  out.modes = JSON.stringify(MODES);
  const json = JSON.stringify(out);
  return { fingerprint: await hex(json), parts: Object.fromEntries(await Promise.all(Object.entries(out).map(async ([k, v]) => [k, (await hex(JSON.stringify(v))).slice(0, 12)]))), size: json.length };
}

// functions/pholamaSiteStudio.ts
var SB = "https://nyswblzzvqzheaxvrqtq.supabase.co";
var FREE_AI = "https://api.free.ai/v1/chat/";
var cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS", "Content-Type": "application/json" };
var send = (status2, body) => new Response(JSON.stringify(body), { status: status2, headers: cors });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (new URL(req.url).pathname.endsWith("/selfcheck")) return send(200, await selfcheck());
  const service = Deno.env.get("PHOLAMA_SUPABASE_SERVICE_KEY") || "", aiKey = Deno.env.get("FREE_AI_API_KEY") || "", seal2 = Deno.env.get("PHOLAMA_SEAL_KEY") || "";
  if (!service || !aiKey || seal2.length < 32) return send(503, { error: "Pholama Studio is not configured yet." });
  if (!isSelfHosted(MODEL)) return send(500, { error: "Pholama Studio is not available right now." });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return send(401, { error: "Log in to use Pholama Studio." });
  const who = await fetch(SB + "/auth/v1/user", { headers: { apikey: service, Authorization: "Bearer " + token } });
  if (!who.ok) return send(401, { error: "Your login expired. Log in again." });
  const user = await who.json().catch(() => null);
  if (!user?.id) return send(401, { error: "Log in to use Pholama Studio." });
  const uid = String(user.id);
  const url = new URL(req.url), after = url.pathname.split("/pholamaSiteStudio")[1] || "";
  const path = after.split("/").filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  let body = {};
  if (req.method !== "GET" && req.method !== "DELETE") body = await req.json().catch(() => ({}));
  else if (req.method === "DELETE") body = await req.json().catch(() => ({}));
  const rest = makeRest(SB, service);
  const callModel = async (msgs, o) => {
    const r = await fetch(FREE_AI, { method: "POST", headers: { Authorization: "Bearer " + aiKey, "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, messages: msgs, max_tokens: 1800, temperature: 0.2 }), signal: o?.signal ?? AbortSignal.timeout(38e3) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error("model " + r.status);
    if (j?.free_ai_usage?.source && j.free_ai_usage.source !== "self_hosted") throw new Error("model not free");
    return String(j?.choices?.[0]?.message?.content || "");
  };
  const spend = async (u, n) => {
    const r = await fetch(SB + "/rest/v1/rpc/pholama_site_spend", { method: "POST", headers: { apikey: service, Authorization: "Bearer " + service, "Content-Type": "application/json" }, body: JSON.stringify({ p_user: u, p_n: n, p_cap: DAILY_RUNS }) });
    if (!r.ok) throw new Error("allowance unavailable");
    const v = await r.json().catch(() => -1);
    return Number(v) >= 0;
  };
  try {
    const res = await handle({ method: req.method, path, query: url.searchParams, body }, { uid, rest, master: seal2, callModel, spend });
    return send(res.status, res.body);
  } catch {
    return send(500, { error: "Something went wrong. Try again in a moment." });
  }
});
