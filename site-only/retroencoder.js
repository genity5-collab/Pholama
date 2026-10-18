// Pholama RetroStudio encoder. Turns Luau text into the CoolFormat string the RetroStudio plugin imports.
// It is a line-oriented compiler: it NEVER runs the Luau, only reads it.
// Format: SUB/ESC separated block records -> raw DEFLATE (level 6) -> base-93 -> header.
// Verified byte-for-byte against the reference golden files in test/retroencoder.test.js.
'use strict';
const zlib = require('zlib');
const CATALOG = require('./retrocatalog.json');

const SUB = '\x1a', ESC = '\x1b';
const HEADER = SUB + '0000000000000004' + ESC;
const B93 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&'()*+,-./:;<=>?@[]^_`{|}~ ";

function encodeBase93(buf) {
  let queue = 0n, bits = 0n, out = '';
  for (const byte of buf) {
    queue += BigInt(byte) << bits; bits += 8n;
    while (bits > 13n) {
      let value = queue & 0x1fffn;
      if (value > 456n) { queue >>= 13n; bits -= 13n; }
      else { value = queue & 0x3fffn; queue >>= 14n; bits -= 14n; }
      out += B93[Number(value % 93n)] + B93[Number(value / 93n)];
    }
  }
  if (bits) {
    out += B93[Number(queue % 93n)];
    if (bits > 7n || queue > 92n) out += B93[Number(queue / 93n)];
  }
  return out;
}
function decodeBase93(str) {
  const lut = new Map([...B93].map((c, i) => [c, i]));
  let queue = 0n, bits = 0n, value = -1, out = [];
  for (const ch of str) {
    if (!lut.has(ch)) throw new Error('bad base-93 character');
    if (value < 0) { value = lut.get(ch); continue; }
    value += lut.get(ch) * 93;
    queue |= BigInt(value) << bits;
    bits += (value & 0x1fff) > 456 ? 13n : 14n;
    while (bits >= 8n) { out.push(Number(queue & 0xffn)); queue >>= 8n; bits -= 8n; }
    value = -1;
  }
  if (value >= 0) {
    queue |= BigInt(value) << bits; bits += 7n;
    while (bits >= 8n) { out.push(Number(queue & 0xffn)); queue >>= 8n; bits -= 8n; }
  }
  return Buffer.from(out);
}
const deflateRaw = s => zlib.deflateRawSync(Buffer.from(s, 'latin1'), { level: 6 });
const envelope = s => HEADER + encodeBase93(deflateRaw(s));

const esc = v => String(v).replace(/[\x00-\x1f\x7f]/g, '');
const NUM = /^-?(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?)$/;
const isNumber = v => NUM.test(String(v).trim());
function parseNum(raw) {
  const r = raw.replace(/_/g, '').trim();
  if (/^-?0[xX]/.test(r)) return Math.trunc(parseInt(r.replace(/^(-?)0[xX]/, '$10x'), 16)) * (r.startsWith('-') ? 1 : 1);
  if (/^-?0[bB]/.test(r)) return (r.startsWith('-') ? -1 : 1) * parseInt(r.replace(/^-?0[bB]/, ''), 2);
  return Math.trunc(parseFloat(r));
}
function hexNumber(v) {
  const raw = v.replace(/_/g, '').trim();
  let n;
  if (/^-?0[xX]/.test(raw)) n = (raw.startsWith('-') ? -1 : 1) * parseInt(raw.replace(/^-?0[xX]/, ''), 16);
  else if (/^-?0[bB]/.test(raw)) n = (raw.startsWith('-') ? -1 : 1) * parseInt(raw.replace(/^-?0[bB]/, ''), 2);
  else n = Math.trunc(parseFloat(raw));
  return Math.max(0, n).toString(16).toUpperCase();
}
function typedValue(value) {
  const v = value.trim();
  if (NUM.test(v)) return ESC + '1' + ESC + hexNumber(v) + ESC + 'Number';
  if (v.length >= 2 && '"\''.includes(v[0]) && v[v.length - 1] === v[0]) return ESC + '1' + ESC + esc(v.slice(1, -1)) + ESC + 'String';
  if (v === 'true') return ESC + '1' + ESC + '1' + ESC + 'Bool';
  if (v === 'false') return ESC + '1' + ESC + '0' + ESC + 'Bool';
  if (v === 'nil') return ESC + '1' + ESC + ESC + 'Nil';
  return ESC + '2' + ESC + esc(v);
}
function position(i) {
  let x = i * 3, y = 0;
  if (x > 36) { y = 4; x -= 37; }
  return x.toString(16).toUpperCase() + '.0,' + y.toString(16).toUpperCase() + '.0';
}
function serialize(b) {
  const child = b.child ? ESC + b.child : '';
  const elseChild = ESC + (b.elseChild || 'nil');
  return SUB + SUB + 'Block' + SUB + 'Type' + ESC + b.type + SUB + 'Name' + ESC + b.name + SUB + 'VisualPosition' + ESC + b.position
    + SUB + 'ChildBlocks' + child + SUB + 'ElseChildBlock' + elseChild + SUB + 'Inputs' + b.inputs + SUB + 'Outputs' + b.outputs;
}
const editor = () => SUB + SUB + 'Editor' + SUB + 'CameraPosition' + ESC + '2.3F,0.3BF' + SUB + 'CameraZoom' + ESC + '0.C2';

function colorComponentHex2(v) {
  const n = Math.max(0, Math.min(255, parseNum(v)));
  return n.toString(16).toUpperCase().padStart(2, '0');
}
// Legacy colour channel: the exact binary value of the double n/255, written in hex (mirrors float.as_integer_ratio()).
function asIntegerRatio(x) {
  const dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, x);
  const hi = dv.getUint32(0), lo = dv.getUint32(4);
  const exp = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e;
  if (exp === 0) e = -1074; else { mant |= 1n << 52n; e = exp - 1075; }
  let num = mant, den = 1n;
  if (e >= 0) num <<= BigInt(e); else den <<= BigInt(-e);
  while (num % 2n === 0n && den % 2n === 0n && den > 1n) { num >>= 1n; den >>= 1n; }
  return [num, den];
}
function legacyColor(v) {
  const n = Math.max(0, Math.min(255, parseNum(v)));
  if (n === 0 || n === 255) return String(n / 255);
  let [num, den] = asIntegerRatio(n / 255);
  let digits = '';
  while (num) { num *= 16n; digits += (num / den).toString(16).toUpperCase(); num = num % den; }
  return '0.' + digits;
}
const isSimpleValue = v => /^(?:-?(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?)|true|false|nil|['"][^'"]*['"]|[\w.]+)$/.test(v.trim());

function normalizeModern(src) {
  let s = src.replace(/\r\n?/g, '\n');
  s = s.replace(/^\s*--![^\n]*$/gm, '');
  s = s.replace(/\bconst\s+(\w+)(?:\s*:\s*[^=\n]+)?\s*=/g, 'local $1 =');
  s = s.replace(/\blocal\s+(\w+)\s*:\s*[^=\n]+\s*=/g, 'local $1 =');
  return s;
}
function stripTrailingComment(line) {
  let quote = null;
  for (let i = 0; i < line.length - 1; i++) {
    const c = line[i];
    if (c === '"' || c === "'") quote = quote === c ? null : (quote === null ? c : quote);
    if (quote === null && line.slice(i, i + 2) === '--') return line.slice(0, i).trim();
  }
  return line;
}
function conditionInputs(expr) {
  const m = /^(.+?)\s*(==|~=|>=|<=|>|<)\s*(.+)$/.exec(expr.trim());
  if (m) return ESC + 'Value 1' + typedValue(m[1]) + ESC + 'Value 2' + typedValue(m[3]) + ESC + 'ComparisonType' + ESC + '0' + ESC + m[2];
  return ESC + 'Value 1' + typedValue(expr) + ESC + 'Value 2' + typedValue('true') + ESC + 'ComparisonType' + ESC + '0' + ESC + '==';
}
function parseOverrides(raw) {
  const o = {};
  if (!raw.trim()) return o;
  for (const item of raw.split(',')) {
    const i = item.indexOf('=');
    if (i < 0 || !item.slice(0, i).trim() || !item.slice(i + 1).trim()) throw new Error('bad override');
    o[item.slice(0, i).trim()] = item.slice(i + 1).trim();
  }
  return o;
}
function catalogInputs(template, overrides) {
  const t = template.split(ESC);
  let pos = 1, out = '';
  while (pos < t.length && t[pos] !== '') {
    const field = t[pos], kindRaw = t[pos + 1] !== undefined ? t[pos + 1] : '0';
    let kind = kindRaw, value = t[pos + 2] !== undefined ? t[pos + 2] : '';
    pos += 3;
    let typeName = '';
    if (kind === '1' && pos < t.length) { typeName = t[pos]; pos += 1; }
    const ov = overrides[field];
    if (ov !== undefined) {
      if (kind === '0') value = ov.length >= 2 && '"\''.includes(ov[0]) && ov[ov.length - 1] === ov[0] ? ov.slice(1, -1) : ov;
      else { const tv = typedValue(ov).split(ESC); kind = tv[1]; value = tv[2]; typeName = tv.length > 3 ? tv[3] : ''; }
    }
    out += ESC + field + ESC + kind + ESC + esc(value);
    if (kind === '1' && typeName) out += ESC + esc(typeName);
  }
  return out;
}

function compile(source) {
  const blocks = [], skipped = [], counters = {}, open = [], top = [];
  const kids = {}, elseKids = {}, activeElse = new Set(), loopStep = {};
  let skipFn = null, skipDepth = 0;
  const add = (type, label, inputs = '', outputs = '') => {
    counters[label] = (counters[label] || 0) + 1;
    const b = { type, name: label + counters[label], position: position(blocks.length), inputs, outputs, child: null, elseChild: null };
    blocks.push(b);
    if (open.length) { const a = open[open.length - 1]; const map = activeElse.has(a.name) ? elseKids : kids; (map[a.name] = map[a.name] || []).push(b); }
    else top.push(b);
    return b;
  };
  const setProp = (obj, prop, valueRef) => add('SetObjectProperty', 'Set Object Property',
    ESC + 'Value' + valueRef + ESC + 'Property' + ESC + '0' + ESC + prop + ESC + 'Object' + ESC + '0' + ESC + obj);
  const ref = name => ESC + '2' + ESC + name;

  for (const rawLine of normalizeModern(source).split('\n')) {
    let line = rawLine.trim(), m;
    if (!line) continue;
    if ((m = /^--@block\s+(\w+)(?:\s+(.*))?$/.exec(line))) {
      const tpl = Object.prototype.hasOwnProperty.call(CATALOG, m[1]) ? CATALOG[m[1]] : null;
      if (!tpl) { skipped.push('Skipped unknown private catalog block: ' + m[1]); continue; }
      try { add(m[1], m[1], catalogInputs(tpl.i, parseOverrides(m[2] || '')), tpl.o); }
      catch { skipped.push('Skipped malformed private catalog directive: ' + m[1]); }
      continue;
    }
    if (line.startsWith('--')) continue;
    line = stripTrailingComment(line);
    if (!line) continue;
    if (skipFn !== null) {
      if (line === 'end') {
        skipDepth -= 1;
        if (skipDepth === 0) { skipped.push('Skip: ' + skipFn.join('')); skipped.push('Skip: end'); skipFn = null; }
        else skipFn.push(line);
        continue;
      }
      skipFn.push(line);
      if (/^(?:local\s+)?function\s+\w+\s*\(.*\)$/.test(line) || /^(?:if|for|while)\b.*(?:then|do)$/.test(line)) skipDepth += 1;
      continue;
    }
    if (/^local\s+function\s+\w+\s*\(.*\)$/.test(line)) { skipFn = [line]; skipDepth = 1; continue; }

    m = /^for\s+(\w+)\s*=\s*([^,]+)\s*,\s*([^,\s]+)(?:\s*,\s*([^\s]+))?\s+do$/.exec(line);
    if (m && isNumber(m[2]) && isNumber(m[3])) {
      const [, v, start, finish, step] = m;
      add('SetVariable1', 'Init ' + v, ESC + 'Value' + typedValue(start), ESC + 'VariableName' + ESC + v);
      const loop = add('WhileLoop3', 'While Loop', ESC + 'Value 1' + typedValue(v) + ESC + 'Value 2' + typedValue(finish) + ESC + 'ComparisonType' + ESC + '0' + ESC + '<=');
      loopStep[loop.name] = [v, step || '1'];
      open.push(loop);
      continue;
    }
    if ((m = /^if\s+(.+)\s+then$/.exec(line))) { open.push(add('If', 'If', conditionInputs(m[1]))); continue; }
    if ((line === 'end' || line === 'end)') && open.length) {
      const closed = open.pop();
      activeElse.delete(closed.name);
      if (loopStep[closed.name]) {
        const [v, step] = loopStep[closed.name];
        open.push(closed);
        add('Addition', 'Step ' + v, ESC + 'Number1' + typedValue(v) + ESC + 'Number2' + typedValue(step), ESC + 'Result' + ESC + v);
        open.pop();
      }
      continue;
    }
    if (line === 'else' && open.length && open[open.length - 1].type === 'If') { activeElse.add(open[open.length - 1].name); continue; }
    if (line.startsWith('elseif ')) { skipped.push('Skipped unsupported control-flow branch: ' + line.slice(0, 72)); continue; }
    if ((m = /^([\w.]+)\.Touched\s*:\s*Connect\s*\(\s*function\s*\(\s*(\w+)\s*\)\s*$/.exec(line))) {
      open.push(add('PartTouched', 'Part Touched', ESC + 'Part' + ESC + '0' + ESC + m[1], ESC + 'otherPart' + ESC + m[2] + ESC + 'EventConnection' + ESC + 'touchConn'));
      continue;
    }
    if ((m = /^([\w.]+)\.MouseButton1Click\s*:\s*Connect\s*\(\s*function\s*\(\s*\)\s*$/.exec(line))) {
      open.push(add('GUILeftMouseButtonClick', 'GUI Left Click', ESC + 'GUIButton' + ESC + '0' + ESC + m[1]));
      continue;
    }
    if ((m = /^print\s*\(\s*(['"])(.*?)\1\s*\)$/.exec(line))) { add('Print', 'Print', ESC + 'Text' + ESC + '0' + ESC + esc(m[2])); continue; }
    if ((m = /^print\s*\(\s*([\w.]+)\s*\)$/.exec(line))) { add('Print', 'Print', ESC + 'Text' + typedValue(m[1])); continue; }
    if ((m = /^(?:task\.)?wait\s*\(\s*([^)]*)\s*\)$/.exec(line))) { add('Wait', 'Wait', ESC + 'Time' + typedValue(m[1].trim() || '0.03')); continue; }
    m = /^local\s+(\w+)\s*=\s*Color3ToBrickColor\s*\(\s*Color3\.fromRGB\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)\s*\)$/.exec(line);
    if (m && [m[2], m[3], m[4]].every(isNumber)) {
      add('Color3ToBrickColor', 'Color3 to BrickColor', ESC + 'Color3' + ESC + '0' + ESC + [m[2], m[3], m[4]].map(colorComponentHex2).join(','), ESC + 'BrickColor' + ESC + m[1]);
      continue;
    }
    if ((m = /^local\s+(\w+)\s*=\s*Vector3\.new\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)$/.exec(line))) {
      add('ConstructVector3', 'Vector3', ESC + 'X' + typedValue(m[2]) + ESC + 'Y' + typedValue(m[3]) + ESC + 'Z' + typedValue(m[4]), ESC + 'Vector3' + ESC + m[1]);
      continue;
    }
    if ((m = /^local\s+(\w+)\s*=\s*\{\s*\}$/.exec(line))) { add('CreateTable', 'Create Table', '', ESC + 'TableVariable' + ESC + m[1]); continue; }
    if ((m = /^local\s+(\w+)\s*=\s*Instance\.new\s*\(\s*(['"])(\w+)\2\s*,\s*([\w.]+)\s*\)$/.exec(line))) {
      add('CreateObject', 'Create Object', ESC + 'Parent' + ESC + '0' + ESC + m[4] + ESC + 'ClassName' + ESC + '0' + ESC + m[3], ESC + 'Object' + ESC + m[1]);
      continue;
    }
    if ((m = /^local\s+(\w+)\s*=\s*Instance\.new\s*\(\s*(['"])(\w+)\2\s*\)$/.exec(line))) {
      add('CreateObject', 'Create Object', ESC + 'Parent' + ESC + '0' + ESC + 'script.Parent' + ESC + 'ClassName' + ESC + '0' + ESC + m[3], ESC + 'Object' + ESC + m[1]);
      continue;
    }
    if ((m = /^local\s+(\w+)\s*=\s*(.+)$/.exec(line)) && isSimpleValue(m[2])) {
      add('SetVariable1', 'Set Variable', ESC + 'Value' + typedValue(m[2]), ESC + 'VariableName' + ESC + m[1]);
      continue;
    }
    m = /^([\w.]+)\.(Size|Position)\s*=\s*UDim2\.new\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)$/.exec(line);
    if (m && [m[3], m[4], m[5], m[6]].every(isNumber)) {
      const [, obj, prop, xs, xo, ys, yo] = m;
      add('ConstructUDim2', 'Construct UDim2', ESC + 'XOffset' + typedValue(xo) + ESC + 'XScale' + typedValue(xs) + ESC + 'YScale' + typedValue(ys) + ESC + 'YOffset' + typedValue(yo), ESC + 'UDim2' + ESC + '_udim0');
      setProp(obj, prop, ref('_udim0'));
      continue;
    }
    m = /^([\w.]+)\.(BackgroundColor3|TextColor3|ImageColor3)\s*=\s*Color3\.fromRGB\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)$/.exec(line);
    if (m && [m[3], m[4], m[5]].every(isNumber)) {
      const c = [m[3], m[4], m[5]].map(legacyColor);
      add('ConstructColor3', 'Construct Color3', ESC + 'R' + ESC + '1' + ESC + c[0] + ESC + 'Number' + ESC + 'G' + ESC + '1' + ESC + c[1] + ESC + 'Number' + ESC + 'B' + ESC + '1' + ESC + c[2] + ESC + 'Number', ESC + 'Color3' + ESC + '_color0');
      setProp(m[1], m[2], ref('_color0'));
      continue;
    }
    m = /^([\w.]+)\.(BackgroundColor3|TextColor3|ImageColor3)\s*=\s*Color3\.new\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)$/.exec(line);
    if (m && [m[3], m[4], m[5]].every(isNumber)) {
      const c = [m[3], m[4], m[5]].map(hexNumber);
      add('ConstructColor3', 'Construct Color3', ESC + 'R' + ESC + '1' + ESC + c[0] + ESC + 'Number' + ESC + 'G' + ESC + '1' + ESC + c[1] + ESC + 'Number' + ESC + 'B' + ESC + '1' + ESC + c[2] + ESC + 'Number', ESC + 'Color3' + ESC + '_color0');
      setProp(m[1], m[2], ref('_color0'));
      continue;
    }
    m = /^([\w.]+)\.CFrame\s*=\s*CFrame\.new\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)$/.exec(line);
    if (m && [m[2], m[3], m[4]].every(isNumber)) {
      add('ConstructCFrame', 'CFrame', ESC + 'Rotation' + ESC + '0' + ESC + '0,0,0' + ESC + 'Position' + ESC + '0' + ESC + [m[2], m[3], m[4]].map(s => s.trim()).join(','), ESC + 'CFrame' + ESC + '_cframe0');
      setProp(m[1], 'CFrame', ref('_cframe0'));
      continue;
    }
    m = /^([\w.]+)\.(\w+)\s*=\s*Vector3\.new\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)$/.exec(line);
    if (m && [m[3], m[4], m[5]].every(isNumber)) {
      add('ConstructVector3', 'Vector3', ESC + 'X' + typedValue(m[3]) + ESC + 'Y' + typedValue(m[4]) + ESC + 'Z' + typedValue(m[5]), ESC + 'Vector3' + ESC + '_vector0');
      setProp(m[1], m[2], ref('_vector0'));
      continue;
    }
    if ((m = /^([\w.]+)\.BrickColor\s*=\s*BrickColor\.new\s*\(\s*(['"])(.*?)\2\s*\)$/.exec(line))) { setProp(m[1], 'BrickColor', typedValue('"' + m[3] + '"')); continue; }
    if ((m = /^([\w.]+)\.Material\s*=\s*Enum\.Material\.(\w+)$/.exec(line))) { setProp(m[1], 'Material', typedValue('"' + m[2] + '"')); continue; }
    if ((m = /^([\w.]+)\.(\w+)\s*=\s*(.+)$/.exec(line)) && isSimpleValue(m[3])) { setProp(m[1], m[2], typedValue(m[3])); continue; }
    if ((m = /^(\w+)\s*\[\s*(.+)\s*\]\s*=\s*(.+)$/.exec(line)) && isSimpleValue(m[2]) && isSimpleValue(m[3])) {
      add('SetTableValue', 'Set Table Value', ESC + 'Value' + typedValue(m[3]) + ESC + 'Key' + typedValue(m[2]) + ESC + 'Table' + ESC + '0' + ESC + m[1]);
      continue;
    }
    skipped.push('Skip: ' + line.slice(0, 72));
  }

  const ordered = b => {
    const out = [], c = kids[b.name] || [], e = elseKids[b.name] || [];
    if (b.type === 'WhileLoop3' && c.length) { out.push(...ordered(c[0])); out.push(b); for (const k of c.slice(1)) out.push(...ordered(k)); return out; }
    for (const k of c) out.push(...ordered(k));
    for (const k of e) out.push(...ordered(k));
    out.push(b);
    return out;
  };
  const link = seq => {
    seq.forEach((b, i) => {
      b.child = i + 1 < seq.length ? seq[i + 1].name : null;
      const c = kids[b.name] || [];
      if (c.length) { b.child = c[0].name; link(c); }
      const e = elseKids[b.name] || [];
      if (e.length) { b.elseChild = e[0].name; link(e); }
    });
  };
  link(top);
  const flat = [];
  for (let i = 0; i < top.length;) {
    const b = top[i], next = top[i + 1];
    if (next && next.type === 'WhileLoop3' && loopStep[next.name]) {
      const lc = kids[next.name] || [];
      if (lc.length) { flat.push(...ordered(lc[0])); flat.push(b); flat.push(next); for (const k of lc.slice(1)) flat.push(...ordered(k)); i += 2; continue; }
    }
    flat.push(...ordered(b)); i += 1;
  }
  flat.forEach((b, i) => { b.position = position(i); });
  const root = { type: 'Comment2', name: 'ROOT', position: '-10.0,-10.0', inputs: ESC + 'Color' + ESC + '0' + ESC + '3FC' + ESC + 'Comment' + ESC + '0' + ESC + 'ROOT', outputs: '', child: top.length ? top[0].name : null, elseChild: null };
  const serialized = editor() + serialize(root) + flat.map(serialize).join('');
  return { serialized, encoded: envelope(serialized), blocks: flat.length, skipped };
}

// Decode a string back to its block count (used to sanity check what we hand to the user).
function check(encoded) {
  if (typeof encoded !== 'string' || !encoded.startsWith(HEADER)) return { valid: false, blocks: 0 };
  try {
    const raw = zlib.inflateRawSync(decodeBase93(encoded.slice(HEADER.length)), { maxOutputLength: 4 * 1024 * 1024 }).toString('latin1');
    if (!raw.startsWith(SUB + SUB + 'Editor')) return { valid: false, blocks: 0 };
    return { valid: true, blocks: Math.max(0, raw.split(SUB + SUB + 'Block').length - 1 - 1) };
  } catch { return { valid: false, blocks: 0 }; }
}
const blockNames = () => Object.keys(CATALOG);

module.exports = { compile, check, encodeBase93, decodeBase93, envelope, blockNames, HEADER };
