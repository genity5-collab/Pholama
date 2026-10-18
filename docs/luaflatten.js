// Lua model flattener. The AI can write REAL Lua (loops, local functions, tables, arithmetic, Model, BrickColor) and this turns it
// into the simple "one statement per line" form that the preview and the RetroStudio encoder read.
// SAFETY: this is a tiny interpreter written from scratch (tokenizer -> parser -> tree walker). It never uses eval or Function,
// has no access to the page, the network or the file system, and stops at hard step / part / depth limits.
// What it understands: local/assign, numbers, strings, booleans, nil, tables, + - * / % ^ .. # == ~= < <= > >= and or not,
// if/elseif/else, numeric for, for-in over ipairs/pairs, while (step-limited), repeat, local function / function, return, break,
// Instance.new, Vector3.new, CFrame.new, Color3.new/fromRGB, BrickColor.new/Red()..., Enum.Material.X, math.*, string.rep/format, table.insert.
// What it does NOT do: anything that needs a running game (events, tasks, services). Those lines are passed through untouched.

export const LIMITS = { steps: 200000, parts: 400, depth: 60, chars: 60000, tokens: 40000 };

class LuaError extends Error {}
const fail = (m, line) => { throw new LuaError((line ? `Line ${line}: ` : '') + m); };

// ---------- tokenizer ----------
const KEYWORDS = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while', 'continue']);
function tokenize(src) {
  const t = []; let i = 0, line = 1; const n = src.length;
  const push = (type, value) => { if (t.length > LIMITS.tokens) fail('The script is too long to read.'); t.push({ type, value, line }); };
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && src[i + 1] === '-') {
      if (src[i + 2] === '[' && /^\[=*\[/.test(src.slice(i + 2))) { const lvl = /^\[(=*)\[/.exec(src.slice(i + 2))[1]; const end = src.indexOf(']' + lvl + ']', i); const stop = end < 0 ? n : end + lvl.length + 2; line += (src.slice(i, stop).match(/\n/g) || []).length; i = stop; continue; }
      while (i < n && src[i] !== '\n') i++; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(0[xX][0-9a-fA-F]+|\d*\.?\d+(?:[eE][+-]?\d+)?)/.exec(src.slice(i)); push('num', Number(m[1])); i += m[1].length; continue;
    }
    if (/[A-Za-z_]/.test(c)) { const m = /^[A-Za-z_]\w*/.exec(src.slice(i))[0]; push(KEYWORDS.has(m) ? 'kw' : 'name', m); i += m.length; continue; }
    if (c === '"' || c === "'") {
      let s = '', j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') { const e = src[j + 1]; s += e === 'n' ? '\n' : e === 't' ? '\t' : e; j += 2; } else { if (src[j] === '\n') fail('Unfinished string.', line); s += src[j++]; } }
      if (j >= n) fail('Unfinished string.', line); push('str', s); i = j + 1; continue;
    }
    if (c === '[' && /^\[=*\[/.test(src.slice(i))) { const lvl = /^\[(=*)\[/.exec(src.slice(i))[1]; const end = src.indexOf(']' + lvl + ']', i); if (end < 0) fail('Unfinished string.', line); const body = src.slice(i + lvl.length + 2, end); push('str', body); line += (body.match(/\n/g) || []).length; i = end + lvl.length + 2; continue; }
    const three = src.slice(i, i + 3), two = src.slice(i, i + 2);
    if (three === '...') { push('op', three); i += 3; continue; }
    if (['==', '~=', '<=', '>=', '..', '//', '+=', '-=', '*=', '/='].includes(two)) { push('op', two); i += 2; continue; }
    if ('+-*/%^#<>=(){}[];:,.'.includes(c)) { push('op', c); i++; continue; }
    fail(`Unexpected character "${c}".`, line);
  }
  push('eof', '<eof>'); return t;
}

// ---------- parser ----------
function parse(tokens) {
  let p = 0; const peek = () => tokens[p], next = () => tokens[p++];
  const isOp = v => peek().type === 'op' && peek().value === v, isKw = v => peek().type === 'kw' && peek().value === v;
  const eatOp = v => (isOp(v) ? (next(), true) : false), eatKw = v => (isKw(v) ? (next(), true) : false);
  const needOp = v => { if (!eatOp(v)) fail(`Expected "${v}" but found "${peek().value}".`, peek().line); };
  const needKw = v => { if (!eatKw(v)) fail(`Expected "${v}" but found "${peek().value}".`, peek().line); };
  const name = () => { if (peek().type !== 'name') fail(`Expected a name but found "${peek().value}".`, peek().line); return next().value; };
  let depth = 0; const enter = () => { if (++depth > LIMITS.depth) fail('The script is nested too deeply.'); }, leave = () => { depth--; };

  function block() {
    const body = [];
    while (!(peek().type === 'eof' || isKw('end') || isKw('else') || isKw('elseif') || isKw('until'))) {
      if (isKw('return')) { body.push(retStmt()); eatOp(';'); break; }
      const s = statement(); if (s) body.push(s); eatOp(';');
    }
    return body;
  }
  function retStmt() { const line = next().line; const vals = []; if (!(peek().type === 'eof' || isKw('end') || isKw('else') || isKw('elseif') || isKw('until') || isOp(';'))) { vals.push(expr()); while (eatOp(',')) vals.push(expr()); } return { t: 'return', vals, line }; }
  function funcBody(line, isMethod) {
    needOp('('); const params = isMethod ? ['self'] : []; let vararg = false;
    if (!isOp(')')) { do { if (eatOp('...')) { vararg = true; break; } params.push(name()); } while (eatOp(',')); }
    needOp(')'); enter(); const body = block(); leave(); needKw('end'); return { t: 'function', params, vararg, body, line };
  }
  function statement() {
    const tk = peek(), line = tk.line;
    if (tk.type === 'kw') {
      if (eatKw('local')) {
        if (eatKw('function')) { const n = name(); return { t: 'localfn', name: n, fn: funcBody(line), line }; }
        const names = [name()]; while (eatOp(',')) names.push(name());
        const vals = []; if (eatOp('=')) { vals.push(expr()); while (eatOp(',')) vals.push(expr()); }
        return { t: 'local', names, vals, line };
      }
      if (eatKw('function')) {
        let target = { t: 'name', name: name(), line }; let isMethod = false;
        while (isOp('.') || isOp(':')) { const colon = next().value === ':'; target = { t: 'index', obj: target, key: { t: 'str', v: name() }, line }; if (colon) { isMethod = true; break; } }
        return { t: 'assign', targets: [target], vals: [funcBody(line, isMethod)], line };
      }
      if (eatKw('if')) {
        const clauses = []; let cond = expr(); needKw('then'); enter(); clauses.push({ cond, body: block() }); leave();
        let orelse = null;
        while (true) {
          if (eatKw('elseif')) { cond = expr(); needKw('then'); enter(); clauses.push({ cond, body: block() }); leave(); continue; }
          if (eatKw('else')) { enter(); orelse = block(); leave(); }
          break;
        }
        needKw('end'); return { t: 'if', clauses, orelse, line };
      }
      if (eatKw('while')) { const cond = expr(); needKw('do'); enter(); const body = block(); leave(); needKw('end'); return { t: 'while', cond, body, line }; }
      if (eatKw('repeat')) { enter(); const body = block(); leave(); needKw('until'); return { t: 'repeat', body, cond: expr(), line }; }
      if (eatKw('for')) {
        const n1 = name();
        if (eatOp('=')) { const a = expr(); needOp(','); const b = expr(); const c = eatOp(',') ? expr() : null; needKw('do'); enter(); const body = block(); leave(); needKw('end'); return { t: 'fornum', v: n1, a, b, c, body, line }; }
        const names = [n1]; while (eatOp(',')) names.push(name()); needKw('in'); const it = [expr()]; while (eatOp(',')) it.push(expr()); needKw('do'); enter(); const body = block(); leave(); needKw('end');
        return { t: 'forin', names, it, body, line };
      }
      if (eatKw('do')) { enter(); const body = block(); leave(); needKw('end'); return { t: 'do', body, line }; }
      if (eatKw('break')) return { t: 'break', line };
      if (eatKw('continue')) return { t: 'continue', line };
      if (isKw('return')) return retStmt();
      fail(`Unexpected "${tk.value}".`, line);
    }
    const e = suffixed();
    if (isOp('=') || isOp(',') || ['+=', '-=', '*=', '/='].includes(peek().value)) {
      const targets = [e]; while (eatOp(',')) targets.push(suffixed());
      if (['+=', '-=', '*=', '/='].includes(peek().value)) { const op = next().value[0]; const v = expr(); return { t: 'assign', targets, vals: [{ t: 'bin', op, a: e, b: v, line }], line }; }
      needOp('='); const vals = [expr()]; while (eatOp(',')) vals.push(expr());
      for (const x of targets) if (x.t !== 'name' && x.t !== 'index') fail('You can only assign to a variable or a field.', line);
      return { t: 'assign', targets, vals, line };
    }
    if (e.t !== 'call' && e.t !== 'method') fail('This line does nothing. A statement must be a call or an assignment.', line);
    return { t: 'expr', e, line };
  }
  const PREC = { or: 1, and: 2, '<': 3, '>': 3, '<=': 3, '>=': 3, '~=': 3, '==': 3, '..': 5, '+': 6, '-': 6, '*': 7, '/': 7, '%': 7, '//': 7, '^': 10 };
  function expr(limit = 0) {
    enter(); let left;
    const tk = peek();
    if (isKw('not') || isOp('-') || isOp('#')) { next(); const operand = expr(8); left = { t: 'un', op: tk.value, a: operand, line: tk.line }; }
    else left = simple();
    while (true) {
      const o = peek(); const op = (o.type === 'op' || o.type === 'kw') ? o.value : null; const pr = op && PREC[op];
      if (!pr || pr <= limit) break;
      next(); const right = expr(op === '..' || op === '^' ? pr - 1 : pr); left = { t: 'bin', op, a: left, b: right, line: o.line };
    }
    leave(); return left;
  }
  function simple() {
    const tk = peek();
    if (tk.type === 'num') { next(); return { t: 'num', v: tk.value }; }
    if (tk.type === 'str') { next(); return { t: 'str', v: tk.value }; }
    if (eatKw('nil')) return { t: 'nil' }; if (eatKw('true')) return { t: 'bool', v: true }; if (eatKw('false')) return { t: 'bool', v: false };
    if (eatOp('...')) return { t: 'vararg' };
    if (eatKw('function')) return funcBody(tk.line);
    if (isOp('{')) return tableCons();
    return suffixed();
  }
  function primary() {
    const tk = peek();
    if (tk.type === 'name') { next(); return { t: 'name', name: tk.value, line: tk.line }; }
    if (eatOp('(')) { const e = expr(); needOp(')'); return { t: 'paren', e, line: tk.line }; }
    fail(`Unexpected "${tk.value}".`, tk.line);
  }
  function suffixed() {
    let e = primary();
    while (true) {
      const tk = peek();
      if (eatOp('.')) { e = { t: 'index', obj: e, key: { t: 'str', v: name() }, line: tk.line }; }
      else if (eatOp('[')) { const k = expr(); needOp(']'); e = { t: 'index', obj: e, key: k, line: tk.line }; }
      else if (eatOp(':')) { const m = name(); e = { t: 'method', obj: e, name: m, args: callArgs(), line: tk.line }; }
      else if (isOp('(') || isOp('{') || peek().type === 'str') e = { t: 'call', fn: e, args: callArgs(), line: tk.line };
      else return e;
    }
  }
  function callArgs() {
    if (peek().type === 'str') return [{ t: 'str', v: next().value }];
    if (isOp('{')) return [tableCons()];
    needOp('('); const args = []; if (!isOp(')')) { do args.push(expr()); while (eatOp(',')); } needOp(')'); return args;
  }
  function tableCons() {
    const line = peek().line; needOp('{'); const items = [];
    while (!isOp('}')) {
      if (isOp('[')) { next(); const k = expr(); needOp(']'); needOp('='); items.push({ k, v: expr() }); }
      else if (peek().type === 'name' && tokens[p + 1].type === 'op' && tokens[p + 1].value === '=') { const k = { t: 'str', v: next().value }; next(); items.push({ k, v: expr() }); }
      else items.push({ k: null, v: expr() });
      if (!(eatOp(',') || eatOp(';'))) break;
    }
    needOp('}'); return { t: 'table', items, line };
  }
  const body = block(); if (peek().type !== 'eof') fail(`Unexpected "${peek().value}".`, peek().line);
  return body;
}

// ---------- values ----------
class LuaTable { constructor() { this.hash = new Map(); this.arr = []; } get(k) { if (typeof k === 'number' && Number.isInteger(k) && k >= 1 && k <= this.arr.length) return this.arr[k - 1]; return this.hash.get(k); }
  set(k, v) { if (typeof k === 'number' && Number.isInteger(k) && k >= 1 && k <= this.arr.length + 1) { if (k === this.arr.length + 1) { if (v !== undefined && v !== null) this.arr.push(v); } else this.arr[k - 1] = v; while (this.arr.length && (this.arr[this.arr.length - 1] === undefined || this.arr[this.arr.length - 1] === null)) this.arr.pop(); return; }
    if (v === undefined || v === null) this.hash.delete(k); else this.hash.set(k, v); }
  len() { return this.arr.length; } }
class Vec { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } }
class Col { constructor(r, g, b) { this.r = r; this.g = g; this.b = b; } }
const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1];
class Cf { constructor(x, y, z, r) { this.x = x; this.y = y; this.z = z; this.r = r || IDENT; } }
// Roblox rotation order: CFrame.Angles(rx, ry, rz) = Rx * Ry * Rz (radians). 3x3 matrices, row-major.
const mmul = (a, b) => { const o = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]); return o; };
const rotX = t => [1, 0, 0, 0, Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t)];
const rotY = t => [Math.cos(t), 0, Math.sin(t), 0, 1, 0, -Math.sin(t), 0, Math.cos(t)];
const rotZ = t => [Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t), 0, 0, 0, 1];
const anglesMat = (rx, ry, rz) => mmul(mmul(rotX(rx), rotY(ry)), rotZ(rz));
const rotVec = (r, v) => ({ x: r[0] * v.x + r[1] * v.y + r[2] * v.z, y: r[3] * v.x + r[4] * v.y + r[5] * v.z, z: r[6] * v.x + r[7] * v.y + r[8] * v.z });
class Inst { constructor(cls) { this.cls = cls; this.props = {}; this.kids = []; this.parent = null; } }
class Fn { constructor(node, env) { this.node = node; this.env = env; } }
class Native { constructor(f) { this.f = f; } }
class Enum { constructor(path) { this.path = path; } }
class BreakSig {} class ContinueSig {} class ReturnSig { constructor(v) { this.v = v; } }

const BRICK = { 'bright red': [196, 40, 28], 'really red': [255, 0, 0], 'bright blue': [13, 105, 172], 'really blue': [0, 0, 255], 'bright yellow': [245, 205, 48], 'new yeller': [255, 255, 0], 'bright green': [75, 151, 75], 'lime green': [0, 255, 0], 'black': [27, 42, 53], 'really black': [17, 17, 17], 'white': [242, 243, 243], 'institutional white': [248, 248, 248], 'medium stone grey': [163, 162, 165], 'dark stone grey': [99, 95, 98], 'light stone grey': [229, 228, 223], 'bright orange': [218, 133, 65], 'hot pink': [255, 102, 204], 'pink': [255, 152, 220], 'bright violet': [107, 50, 124], 'royal purple': [98, 37, 209], 'cyan': [4, 175, 236], 'teal': [18, 238, 212], 'brown': [124, 92, 70], 'reddish brown': [105, 64, 40], 'nougat': [204, 142, 105], 'brick yellow': [215, 197, 154], 'earth green': [39, 70, 45], 'dark green': [40, 127, 71], 'navy blue': [0, 32, 96], 'gold': [239, 184, 56], 'silver': [196, 196, 196], 'lily white': [236, 236, 236], 'sand red': [149, 121, 119], 'toothpaste': [16, 42, 220], 'magenta': [170, 0, 170] };
export const brickRgb = nm => BRICK[String(nm || '').toLowerCase()] || null;
export function nearestBrick(r, g, b) {
  let best = null, bd = Infinity;
  for (const [nm, c] of Object.entries(BRICK)) { const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2; if (d < bd) { bd = d; best = nm; } }
  return best.replace(/\b\w/g, ch => ch.toUpperCase());
}

const tstr = v => (v === null || v === undefined ? 'nil' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6)) : v instanceof Vec ? `${tstr(v.x)}, ${tstr(v.y)}, ${tstr(v.z)}` : typeof v === 'object' && v instanceof Inst ? v.props.Name || v.cls : String(v));
const truthy = v => !(v === null || v === undefined || v === false);

// ---------- interpreter ----------
function flattenInner(source, opts = {}) {
  const text = String(source || '');
  const result = { ok: false, lua: '', parts: [], models: [], diagnostics: [], prints: [], steps: 0, flattened: false };
  if (text.length > LIMITS.chars) { result.diagnostics.push(`The script is longer than ${LIMITS.chars.toLocaleString()} characters.`); return result; }
  const limits = { ...LIMITS, ...(opts.limits || {}) };
  let steps = 0; const tick = line => { if (++steps > limits.steps) fail('The script ran too long (a loop may never end).', line); };
  const all = []; // every Instance created, in order
  const passthrough = []; // lines of the original script that need a running game
  let ast;
  try { ast = parse(tokenize(text)); } catch (e) { if (e instanceof LuaError) { result.diagnostics.push(e.message); return result; } throw e; }

  const mkEnv = parent => ({ vars: new Map(), parent });
  const lookup = (env, n) => { for (let e = env; e; e = e.parent) if (e.vars.has(n)) return e; return null; };
  const num = (v, line, what = 'a number') => { if (typeof v !== 'number' || Number.isNaN(v)) fail(`Expected ${what} but got ${v === undefined || v === null ? 'nil' : typeof v}.`, line); return v; };
  const asNum = (v, line) => (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : num(v, line));

  const G = mkEnv(null);
  const def = (n, v) => G.vars.set(n, v);
  const nat = f => new Native(f);
  const tbl = o => { const t = new LuaTable(); for (const [k, v] of Object.entries(o)) t.set(k, v); return t; };
  const newInst = (cls, parent) => {
    if (all.length >= limits.parts * 3) fail(`Too many objects (limit ${limits.parts * 3}).`);
    const i = new Inst(cls); i.props.Name = cls; all.push(i); if (parent instanceof Inst) { i.parent = parent; parent.kids.push(i); } return i;
  };
  def('workspace', Object.assign(new Inst('Workspace'), { props: { Name: 'Workspace' } }));
  const ws = G.vars.get('workspace');
  def('game', Object.assign(new Inst('DataModel'), { props: { Name: 'game' } }));
  def('Instance', tbl({ new: nat((a, line) => { const cls = String(a[0]); if (!/^[A-Za-z]+$/.test(cls)) fail('Instance.new needs a class name.', line); return newInst(cls, a[1]); }) }));
  def('Vector3', tbl({ new: nat((a, line) => new Vec(asNum(a[0] ?? 0, line), asNum(a[1] ?? 0, line), asNum(a[2] ?? 0, line))), zero: new Vec(0, 0, 0), one: new Vec(1, 1, 1) }));
  def('CFrame', tbl({ new: nat((a, line) => (a[0] instanceof Vec ? new Cf(a[0].x, a[0].y, a[0].z) : new Cf(asNum(a[0] ?? 0, line), asNum(a[1] ?? 0, line), asNum(a[2] ?? 0, line))), 'CFrame'), Angles: nat((a, line) => new Cf(0, 0, 0, anglesMat(asNum(a[0] ?? 0, line), asNum(a[1] ?? 0, line), asNum(a[2] ?? 0, line)))), fromEulerAnglesXYZ: nat((a, line) => new Cf(0, 0, 0, anglesMat(asNum(a[0] ?? 0, line), asNum(a[1] ?? 0, line), asNum(a[2] ?? 0, line)))), fromOrientation: nat((a, line) => new Cf(0, 0, 0, mmul(mmul(rotY(asNum(a[1] ?? 0, line)), rotX(asNum(a[0] ?? 0, line))), rotZ(asNum(a[2] ?? 0, line))))), identity: new Cf(0, 0, 0) }));
  def('Color3', tbl({ new: nat((a, line) => new Col(Math.round(asNum(a[0] ?? 0, line) * 255), Math.round(asNum(a[1] ?? 0, line) * 255), Math.round(asNum(a[2] ?? 0, line) * 255))), fromRGB: nat((a, line) => new Col(asNum(a[0] ?? 0, line), asNum(a[1] ?? 0, line), asNum(a[2] ?? 0, line))) }));
  const brickTable = new LuaTable();
  brickTable.set('new', nat((a, line) => { const nm = typeof a[0] === 'string' ? a[0] : null; const rgb = nm && brickRgb(nm); const c = new Col(...(rgb || [163, 162, 165])); c.brick = nm || 'Medium stone grey'; return c; }));
  for (const [k, v] of Object.entries({ Red: 'Bright red', Blue: 'Bright blue', Yellow: 'Bright yellow', Green: 'Bright green', Black: 'Black', White: 'White', Gray: 'Medium stone grey' })) brickTable.set(k, nat(() => { const c = new Col(...BRICK[v.toLowerCase()]); c.brick = v; return c; }));
  def('BrickColor', brickTable);
  const enumRoot = new Enum('Enum'); def('Enum', enumRoot);
  const mathT = tbl({ floor: nat(a => Math.floor(a[0])), ceil: nat(a => Math.ceil(a[0])), abs: nat(a => Math.abs(a[0])), sqrt: nat(a => Math.sqrt(a[0])), sin: nat(a => Math.sin(a[0])), cos: nat(a => Math.cos(a[0])), tan: nat(a => Math.tan(a[0])), rad: nat(a => a[0] * Math.PI / 180), deg: nat(a => a[0] * 180 / Math.PI), pi: Math.PI, huge: Infinity, max: nat(a => Math.max(...a)), min: nat(a => Math.min(...a)), pow: nat(a => Math.pow(a[0], a[1])), fmod: nat(a => a[0] % a[1]), round: nat(a => Math.round(a[0])), clamp: nat(a => Math.min(Math.max(a[0], a[1]), a[2])),
    random: nat(a => { const r = (() => { rng = (rng * 1664525 + 1013904223) % 4294967296; return rng / 4294967296; })(); return a.length === 0 ? r : a.length === 1 ? 1 + Math.floor(r * a[0]) : a[0] + Math.floor(r * (a[1] - a[0] + 1)); }), randomseed: nat(a => { rng = (Number(a[0]) || 1) % 4294967296; return null; }) });
  let rng = 12345; def('math', mathT);
  def('string', tbl({ rep: nat(a => { const str = String(a[0]), k = Math.max(0, a[1] | 0); if (str.length * k > 20000) fail('That text is too long.'); return str.repeat(k); }), upper: nat(a => String(a[0]).toUpperCase()), lower: nat(a => String(a[0]).toLowerCase()), len: nat(a => String(a[0]).length), sub: nat(a => String(a[0]).slice(Math.max(0, (a[1] | 0) - 1), a[2] === undefined ? undefined : a[2] | 0)),
    format: nat(a => { let i = 1; return String(a[0]).replace(/%([-+ 0#]*\d*(?:\.\d+)?)([dsfgxi%])/g, (m, f, c) => { if (c === '%') return '%'; const v = a[i++]; if (c === 's') return tstr(v); if (c === 'd' || c === 'i') return String(Math.trunc(Number(v))); if (c === 'x') return Number(v).toString(16); const d = /\.(\d+)/.exec(f); return d ? Number(v).toFixed(Number(d[1])) : String(Number(v)); }); }) }));
  def('table', tbl({ insert: nat(a => { if (a.length >= 3) { a[0].arr.splice(a[1] - 1, 0, a[2]); } else a[0].set(a[0].len() + 1, a[1]); return null; }), remove: nat(a => { const t = a[0]; if (!t.len()) return null; const at = a[1] === undefined ? t.len() : a[1]; return t.arr.splice(at - 1, 1)[0]; }), concat: nat(a => a[0].arr.map(tstr).join(a[1] === undefined ? '' : String(a[1]))), unpack: nat(a => a[0].arr.slice()) }));
  def('tostring', nat(a => tstr(a[0]))); def('tonumber', nat(a => { const n = Number(a[0]); return Number.isNaN(n) ? null : n; })); def('type', nat(a => (a[0] === null || a[0] === undefined ? 'nil' : typeof a[0] === 'number' ? 'number' : typeof a[0] === 'string' ? 'string' : typeof a[0] === 'boolean' ? 'boolean' : a[0] instanceof LuaTable ? 'table' : a[0] instanceof Fn || a[0] instanceof Native ? 'function' : 'userdata')));
  def('typeof', G.vars.get('type'));
  def('print', nat(a => { if (result.prints.length < 50) result.prints.push(a.map(tstr).join(' ')); return null; })); def('warn', G.vars.get('print'));
  def('wait', nat(() => 0)); def('select', nat(a => a[0] === '#' ? a.length - 1 : a.slice(a[0]))); def('assert', nat(a => { if (!truthy(a[0])) fail(String(a[1] || 'assertion failed')); return a[0]; })); def('error', nat(a => fail(String(a[0]))));
  def('ipairs', nat(a => { const t = a[0]; let i = 0; return [nat(() => { i++; return i <= t.len() ? [i, t.arr[i - 1]] : null; })]; }));
  def('pairs', nat(a => { const t = a[0]; const keys = [...t.arr.map((_, i) => i + 1), ...t.hash.keys()]; let i = 0; return [nat(() => { if (i >= keys.length) return null; const k = keys[i++]; return [k, t.get(k)]; })]; }));
  def('pcall', nat(a => { try { const r = callFn(a[0], a.slice(1), 0); return [true, ...(Array.isArray(r) ? r : [r])]; } catch (e) { if (e instanceof LuaError) return [false, e.message]; throw e; } }));
  def('setmetatable', nat(a => a[0])); def('next', nat(a => { const t = a[0]; const keys = [...t.arr.map((_, i) => i + 1), ...t.hash.keys()]; return keys.length ? [keys[0], t.get(keys[0])] : null; }));
  def('Random', tbl({ new: nat(() => tbl({ NextNumber: nat(() => mathT.get('random').f([])), NextInteger: nat(a => mathT.get('random').f(a)) })) }));
  def('script', Object.assign(new Inst('Script'), { props: { Name: 'Script' }, parent: ws })); def('task', tbl({ wait: nat(() => 0), spawn: nat(a => { callFn(a[0], a.slice(1), 0); return null; }), defer: nat(a => { callFn(a[0], a.slice(1), 0); return null; }) }));
  def('Color3', G.vars.get('Color3'));

  const getIndex = (obj, key, line) => {
    if (obj instanceof LuaTable) return obj.get(key);
    if (obj instanceof Enum) return new Enum(obj.path + '.' + key);
    if (obj instanceof Vec) { if (key === 'X' || key === 'x') return obj.x; if (key === 'Y' || key === 'y') return obj.y; if (key === 'Z' || key === 'z') return obj.z; return null; }
    if (obj instanceof Cf) { if (key === 'Position') return new Vec(obj.x, obj.y, obj.z); if (key === 'X') return obj.x; if (key === 'Y') return obj.y; if (key === 'Z') return obj.z; return null; }
    if (obj instanceof Col) { if (key === 'R') return obj.r / 255; if (key === 'G') return obj.g / 255; if (key === 'B') return obj.b / 255; return null; }
    if (obj instanceof Inst) {
      if (key === 'Parent') return obj.parent; if (key === 'ClassName') return obj.cls;
      if (key === 'Position') { const c = obj.props.CFrame || obj.props.Position; return c instanceof Cf ? new Vec(c.x, c.y, c.z) : c; }
      if (key === 'CFrame' && obj.props.CFrame === undefined && obj.props.Position instanceof Vec) return new Cf(obj.props.Position.x, obj.props.Position.y, obj.props.Position.z);
      const kid = obj.kids.find(k => k.props.Name === key); if (kid && obj.props[key] === undefined) return kid;
      return obj.props[key] === undefined ? null : obj.props[key];
    }
    if (typeof obj === 'string') { const s = G.vars.get('string').get(key); return s || null; }
    if (obj === null || obj === undefined) fail(`Cannot read "${tstr(key)}" from nil.`, line);
    return null;
  };
  const setIndex = (obj, key, val, line) => {
    if (obj instanceof LuaTable) { obj.set(key, val); return; }
    if (obj instanceof Inst) {
      if (key === 'Parent') { if (obj.parent) obj.parent.kids = obj.parent.kids.filter(k => k !== obj); obj.parent = val instanceof Inst ? val : null; if (obj.parent) obj.parent.kids.push(obj); return; }
      if (key === 'Position' && val instanceof Vec) { const keep = obj.props.CFrame instanceof Cf ? obj.props.CFrame.r : null; if (keep) { obj.props.CFrame = new Cf(val.x, val.y, val.z, keep); delete obj.props.Position; } else { obj.props.Position = val; delete obj.props.CFrame; } return; }
      if (key === 'CFrame' && val instanceof Cf) { obj.props.CFrame = val; delete obj.props.Position; return; }
      if ((key === 'Orientation' || key === 'Rotation') && val instanceof Vec) { const d = Math.PI / 180, cur = obj.props.CFrame instanceof Cf ? obj.props.CFrame : obj.props.Position instanceof Vec ? new Cf(obj.props.Position.x, obj.props.Position.y, obj.props.Position.z) : new Cf(0, 0, 0); obj.props.CFrame = new Cf(cur.x, cur.y, cur.z, mmul(mmul(rotY(val.y * d), rotX(val.x * d)), rotZ(val.z * d))); delete obj.props.Position; return; }
      obj.props[key] = val; return;
    }
    fail(`Cannot set "${tstr(key)}" on this value.`, line);
  };
  const arith = (op, a, b, line) => {
    if (op === '+' || op === '-' || op === '*' || op === '/') {
      if (a instanceof Vec && b instanceof Vec) return op === '+' ? new Vec(a.x + b.x, a.y + b.y, a.z + b.z) : op === '-' ? new Vec(a.x - b.x, a.y - b.y, a.z - b.z) : op === '*' ? new Vec(a.x * b.x, a.y * b.y, a.z * b.z) : new Vec(a.x / b.x, a.y / b.y, a.z / b.z);
      if (a instanceof Vec && typeof b === 'number') return op === '*' ? new Vec(a.x * b, a.y * b, a.z * b) : op === '/' ? new Vec(a.x / b, a.y / b, a.z / b) : fail('A Vector3 can only be multiplied or divided by a number.', line);
      if (typeof a === 'number' && b instanceof Vec && op === '*') return new Vec(a * b.x, a * b.y, a * b.z);
      if (a instanceof Cf && b instanceof Cf && op === '*') { const t = rotVec(a.r, b); return new Cf(a.x + t.x, a.y + t.y, a.z + t.z, mmul(a.r, b.r)); }
      if (a instanceof Cf && b instanceof Vec && op === '*') { const t = rotVec(a.r, b); return new Vec(a.x + t.x, a.y + t.y, a.z + t.z); }
      if (a instanceof Cf && b instanceof Vec) return op === '+' ? new Cf(a.x + b.x, a.y + b.y, a.z + b.z, a.r) : new Cf(a.x - b.x, a.y - b.y, a.z - b.z, a.r);
    }
    const x = asNum(a, line), y = asNum(b, line);
    switch (op) { case '+': return x + y; case '-': return x - y; case '*': return x * y; case '/': return x / y; case '%': return x - Math.floor(x / y) * y; case '^': return Math.pow(x, y); case '//': return Math.floor(x / y); }
    return null;
  };
  const eq = (a, b) => (a instanceof Vec && b instanceof Vec ? a.x === b.x && a.y === b.y && a.z === b.z : a === b || (a === null && b === undefined) || (a === undefined && b === null));
  const callFn = (f, args, line, depth = 0) => {
    tick(line);
    if (f instanceof Native) { const r = f.f(args, line); return r === undefined ? null : r; }
    if (!(f instanceof Fn)) fail('You tried to call something that is not a function.', line);
    if (depth > 120 || callDepth > 120) fail('A function calls itself too many times.', line);
    const env = mkEnv(f.env); f.node.params.forEach((p, i) => env.vars.set(p, args[i] === undefined ? null : args[i]));
    if (f.node.vararg) env.vars.set('...', args.slice(f.node.params.length));
    callDepth++;
    try { run(f.node.body, env); } catch (s) { if (s instanceof ReturnSig) return s.v; throw s; } finally { callDepth--; }
    return null;
  };
  let callDepth = 0;
  const first = v => (Array.isArray(v) ? (v.length ? v[0] : null) : v);
  const evalMulti = (nodes, env) => { const out = []; nodes.forEach((n, i) => { const v = ev(n, env, true); if (i === nodes.length - 1 && Array.isArray(v) && (n.t === 'call' || n.t === 'method' || n.t === 'vararg')) out.push(...v); else out.push(first(v)); }); return out; };
  function ev(n, env, multi = false) {
    tick(n.line);
    switch (n.t) {
      case 'num': case 'str': case 'bool': return n.v; case 'nil': return null;
      case 'vararg': { const e = lookup(env, '...'); return e ? e.vars.get('...') : []; }
      case 'paren': return first(ev(n.e, env));
      case 'name': { const e = lookup(env, n.name); return e ? e.vars.get(n.name) : null; }
      case 'index': return getIndex(first(ev(n.obj, env)), first(ev(n.key, env)), n.line);
      case 'table': { const t = new LuaTable(); let idx = 1; n.items.forEach((it, i) => { if (it.k) t.set(first(ev(it.k, env)), first(ev(it.v, env))); else { const v = ev(it.v, env, true); if (i === n.items.length - 1 && Array.isArray(v) && (it.v.t === 'call' || it.v.t === 'method')) v.forEach(x => t.set(idx++, x)); else t.set(idx++, first(v)); } }); return t; }
      case 'function': return new Fn(n, env);
      case 'un': { const a = first(ev(n.a, env)); if (n.op === 'not') return !truthy(a); if (n.op === '#') return a instanceof LuaTable ? a.len() : typeof a === 'string' ? a.length : fail('You can only take the length of a table or text.', n.line); if (a instanceof Vec) return new Vec(-a.x, -a.y, -a.z); return -asNum(a, n.line); }
      case 'bin': {
        if (n.op === 'and') { const a = first(ev(n.a, env)); return truthy(a) ? first(ev(n.b, env)) : a; }
        if (n.op === 'or') { const a = first(ev(n.a, env)); return truthy(a) ? a : first(ev(n.b, env)); }
        const a = first(ev(n.a, env)), b = first(ev(n.b, env));
        if (n.op === '..') { const sa = tstr(a), sb = tstr(b); if (sa.length + sb.length > 20000) fail('That text is too long.', n.line); return sa + sb; }
        if (n.op === '==') return eq(a, b); if (n.op === '~=') return !eq(a, b);
        if (['<', '>', '<=', '>='].includes(n.op)) { const x = typeof a === 'string' && typeof b === 'string' ? a : asNum(a, n.line), y = typeof a === 'string' && typeof b === 'string' ? b : asNum(b, n.line); return n.op === '<' ? x < y : n.op === '>' ? x > y : n.op === '<=' ? x <= y : x >= y; }
        return arith(n.op, a, b, n.line);
      }
      case 'call': { const f = first(ev(n.fn, env)); const args = evalMulti(n.args, env); return callFn(f, args, n.line); }
      case 'method': {
        const obj = first(ev(n.obj, env)); const args = evalMulti(n.args, env);
        if (obj instanceof Inst) {
          if (n.name === 'Clone') return cloneTree(obj, null);
          if (n.name === 'Destroy') { if (obj.parent) obj.parent.kids = obj.parent.kids.filter(k => k !== obj); const i = all.indexOf(obj); if (i >= 0) all.splice(i, 1); obj.parent = null; return null; }
          if (n.name === 'FindFirstChild') return obj.kids.find(k => k.props.Name === args[0]) || null;
          if (n.name === 'GetChildren') { const t = new LuaTable(); obj.kids.forEach((k, i) => t.set(i + 1, k)); return t; }
          if (n.name === 'SetPrimaryPartCFrame' || n.name === 'MoveTo' || n.name === 'PivotTo') { const v = args[0]; if (v instanceof Vec || v instanceof Cf) moveModel(obj, v); return null; }
          return null;   // events (Connect) and other game-only calls: nothing to run in a preview
        }
        if (typeof obj === 'string') { const f = G.vars.get('string').get(n.name); if (f) return callFn(f, [obj, ...args], n.line); }
        if (obj instanceof LuaTable) { const f = obj.get(n.name); if (f) return callFn(f, [obj, ...args], n.line); }
        return null;
      }
    }
    fail('Unsupported expression.', n.line);
  }
  const cloneTree = (inst, parent) => { const c = newInst(inst.cls, parent); Object.assign(c.props, inst.props); for (const k of inst.kids) cloneTree(k, c); return c; };
  const centerOf = m => { const ps = []; const walk = i => { if (i.cls !== 'Model' && i.cls !== 'Folder') ps.push(i); i.kids.forEach(walk); }; walk(m); return ps; };
  const moveModel = (m, v) => { const ps = centerOf(m).filter(p => p.props.Position instanceof Vec || p.props.CFrame instanceof Cf); if (!ps.length) return; const pos = p => (p.props.CFrame instanceof Cf ? p.props.CFrame : p.props.Position); const c = ps.reduce((a, p) => ({ x: a.x + pos(p).x / ps.length, y: a.y + pos(p).y / ps.length, z: a.z + pos(p).z / ps.length }), { x: 0, y: 0, z: 0 }); for (const p of ps) { const q = pos(p); const nv = new Vec(q.x - c.x + v.x, q.y - c.y + v.y, q.z - c.z + v.z); if (p.props.CFrame instanceof Cf) p.props.CFrame = new Cf(nv.x, nv.y, nv.z); else p.props.Position = nv; } };

  function run(body, env) {
    for (const s of body) {
      tick(s.line);
      switch (s.t) {
        case 'local': { const vals = evalMulti(s.vals, env); s.names.forEach((nm, i) => env.vars.set(nm, vals[i] === undefined ? null : vals[i])); break; }
        case 'localfn': { env.vars.set(s.name, null); env.vars.set(s.name, new Fn(s.fn, env)); break; }
        case 'assign': {
          const vals = evalMulti(s.vals, env);
          s.targets.forEach((t, i) => { const v = vals[i] === undefined ? null : vals[i]; if (t.t === 'name') { const e = lookup(env, t.name) || G; e.vars.set(t.name, v); } else setIndex(first(ev(t.obj, env)), first(ev(t.key, env)), v, t.line); });
          break;
        }
        case 'expr': ev(s.e, env); break;
        case 'if': { let done = false; for (const c of s.clauses) if (truthy(first(ev(c.cond, env)))) { run(c.body, mkEnv(env)); done = true; break; } if (!done && s.orelse) run(s.orelse, mkEnv(env)); break; }
        case 'while': { while (truthy(first(ev(s.cond, env)))) { try { run(s.body, mkEnv(env)); } catch (x) { if (x instanceof BreakSig) break; if (x instanceof ContinueSig) continue; throw x; } } break; }
        case 'repeat': { do { try { run(s.body, mkEnv(env)); } catch (x) { if (x instanceof BreakSig) break; if (x instanceof ContinueSig) continue; throw x; } } while (!truthy(first(ev(s.cond, env)))); break; }
        case 'fornum': {
          const a = asNum(first(ev(s.a, env)), s.line), b = asNum(first(ev(s.b, env)), s.line), c = s.c ? asNum(first(ev(s.c, env)), s.line) : 1; if (c === 0) fail('A for loop step cannot be 0.', s.line);
          for (let i = a; c > 0 ? i <= b + 1e-9 : i >= b - 1e-9; i += c) { const e = mkEnv(env); e.vars.set(s.v, Math.round(i * 1e9) / 1e9); try { run(s.body, e); } catch (x) { if (x instanceof BreakSig) break; if (x instanceof ContinueSig) continue; throw x; } tick(s.line); }
          break;
        }
        case 'forin': {
          const its = evalMulti(s.it, env); const f = its[0]; if (!(f instanceof Native || f instanceof Fn)) fail('A for-in loop needs ipairs(...) or pairs(...).', s.line);
          while (true) { const r = callFn(f, [its[1], its[2]], s.line); if (r === null || r === undefined) break; const row = Array.isArray(r) ? r : [r]; if (row[0] === null || row[0] === undefined) break; const e = mkEnv(env); s.names.forEach((nm, i) => e.vars.set(nm, row[i] === undefined ? null : row[i])); try { run(s.body, e); } catch (x) { if (x instanceof BreakSig) break; if (x instanceof ContinueSig) continue; throw x; } }
          break;
        }
        case 'do': run(s.body, mkEnv(env)); break;
        case 'break': throw new BreakSig(); case 'continue': throw new ContinueSig();
        case 'return': throw new ReturnSig(s.vals.length === 0 ? null : s.vals.length === 1 ? ev(s.vals[0], env, true) : evalMulti(s.vals, env));
      }
    }
  }
  // Enum.* values become plain strings on property set
  const enumName = v => (v instanceof Enum ? v.path.split('.').pop() : v);
  try { run(ast, mkEnv(G)); } catch (e) {
    if (e instanceof LuaError) { result.diagnostics.push(e.message); }
    else if (e instanceof ReturnSig || e instanceof BreakSig || e instanceof ContinueSig) { /* top-level return ends the script */ }
    else throw e;
  }
  result.steps = steps;

  // ---------- walk the tree and write the flat script ----------
  const isUnder = (i, root) => { for (let p = i; p; p = p.parent) if (p === root) return true; return false; };
  const PARTS = new Set(['Part', 'WedgePart', 'CornerWedgePart', 'TrussPart', 'SpawnLocation', 'Seat', 'MeshPart']);
  const lines = []; let nPart = 0, nModel = 0; const used = new Set(); const mname = (nm, fallback) => { let base = String(nm || fallback).replace(/[^A-Za-z0-9_]/g, '') || fallback; if (/^\d/.test(base)) base = '_' + base; let n = base, k = 2; while (used.has(n)) n = base + k++; used.add(n); return n; };
  const fmt = n => String(Math.round(n * 1000) / 1000);
  const emit = (inst, parentVar) => {
    const isPart = PARTS.has(inst.cls), isModel = inst.cls === 'Model' || inst.cls === 'Folder';
    if (!isPart && !isModel) return;
    if (isPart) { if (nPart >= limits.parts) { if (nPart === limits.parts) result.diagnostics.push(`Preview stopped at ${limits.parts} parts.`); nPart++; return; } nPart++; }
    const v = mname(inst.props.Name, isPart ? 'Part' : 'Model');
    lines.push(`local ${v} = Instance.new("${isPart ? (inst.cls === 'MeshPart' || inst.cls === 'SpawnLocation' || inst.cls === 'Seat' ? 'Part' : inst.cls) : 'Model'}", ${parentVar})`);
    if (isModel) nModel++;
    const pr = inst.props;
    if (typeof pr.Name === 'string' && pr.Name !== v) lines.push(`${v}.Name = "${pr.Name.replace(/[\\"\n]/g, '').slice(0, 48)}"`);
    if (isPart) {
      const size = pr.Size instanceof Vec ? pr.Size : new Vec(4, 1, 2);
      lines.push(`${v}.Size = Vector3.new(${fmt(size.x)}, ${fmt(size.y)}, ${fmt(size.z)})`);
      const pos = pr.CFrame instanceof Cf ? pr.CFrame : pr.Position instanceof Vec ? pr.Position : new Vec(0, 0, 0);
      lines.push(`${v}.Position = Vector3.new(${fmt(pos.x)}, ${fmt(pos.y)}, ${fmt(pos.z)})`);
      const col = pr.Color instanceof Col ? pr.Color : pr.BrickColor instanceof Col ? pr.BrickColor : null;
      if (pr.BrickColor instanceof Col && pr.BrickColor.brick) lines.push(`${v}.BrickColor = BrickColor.new("${pr.BrickColor.brick}")`);
      if (col && !(pr.BrickColor instanceof Col && pr.BrickColor.brick)) lines.push(`${v}.BrickColor = BrickColor.new("${nearestBrick(col.r, col.g, col.b)}")`);   // blocks colour parts by BrickColor name, so an RGB colour becomes the closest one
      if (pr.Material !== undefined) { const m = enumName(pr.Material); if (/^[A-Za-z]+$/.test(String(m))) lines.push(`${v}.Material = Enum.Material.${m}`); }
      if (pr.Anchored !== undefined) lines.push(`${v}.Anchored = ${truthy(pr.Anchored) ? 'true' : 'false'}`);
      if (pr.CanCollide === false) lines.push(`${v}.CanCollide = false`);
      if (typeof pr.Transparency === 'number' && pr.Transparency > 0) lines.push(`${v}.Transparency = ${fmt(pr.Transparency)}`);
      const sh = enumName(pr.Shape); if (sh && /^(Ball|Cylinder|Block)$/.test(String(sh))) lines.push(`${v}.Shape = Enum.PartType.${sh}`);
      // Roblox has Y up; the viewport draws [x, depth, height], so Y and Z swap here and only here. The rotation matrix is swapped the same way (P * R * P).
      const rm = pr.CFrame instanceof Cf ? pr.CFrame.r : IDENT, sw = [0, 2, 1], rot = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) rot.push(rm[sw[i] * 3 + sw[j]]);
      result.parts.push({ rot, name: typeof pr.Name === 'string' ? pr.Name : v, type: inst.cls === 'WedgePart' || inst.cls === 'CornerWedgePart' || inst.cls === 'TrussPart' ? inst.cls : 'Part', size: [size.x, size.z, size.y].map(n => Math.max(0.2, Math.min(60, n))), position: [pos.x, pos.z, pos.y].map(n => Math.max(-200, Math.min(200, n))), color: col ? [col.r, col.g, col.b] : [163, 162, 165], material: String(enumName(pr.Material) || 'Plastic'), anchored: pr.Anchored === undefined ? true : truthy(pr.Anchored), shape: sh || 'Block', transparency: typeof pr.Transparency === 'number' ? pr.Transparency : 0, parented: true, model: parentVar === 'workspace' ? null : parentVar });
    } else result.models.push({ name: typeof pr.Name === 'string' ? pr.Name : v, parts: 0 });
    for (const k of inst.kids) emit(k, v);
  };
  for (const k of ws.kids) emit(k, 'workspace');
  // objects the script made but never parented stay hidden, exactly like the game
  const unparented = all.filter(i => PARTS.has(i.cls) && !isUnder(i, ws)).length;
  if (unparented) result.diagnostics.push(`${unparented} part${unparented === 1 ? '' : 's'} ${unparented === 1 ? 'is' : 'are'} not parented to workspace (or a Model inside workspace), so ${unparented === 1 ? 'it is' : 'they are'} not shown.`);
  for (const p of result.prints) lines.push(`print("${String(p).replace(/[\\"\n]/g, '').slice(0, 80)}")`);
  result.lua = lines.join('\n'); result.flattened = true; result.ok = result.parts.length > 0 && !result.diagnostics.some(d => !/not parented|stopped at/.test(d));
  void passthrough;
  return result;
}

// The public entry. Whatever the script does, this returns a result and never throws into the page.
export function flatten(source, opts = {}) {
  try { return flattenInner(source, opts); }
  catch (e) { return { ok: false, lua: '', parts: [], models: [], diagnostics: ['The script could not be read safely: ' + String((e && e.message) || e).slice(0, 100)], prints: [], steps: 0, flattened: false }; }
}
