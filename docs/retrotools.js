// RetroStudio helpers: starter templates, importing script files, exporting every script as one bundle.
// Pure functions (no page access) so they can be tested without a browser. app.js wires them to buttons.

// One statement per line, round shapes where the real thing is round: these also teach the style the AI is asked to use.
export const TEMPLATES = [
  { id: 'car', name: 'Car', source: `local car = Instance.new("Model", workspace)
car.Name = "Car"
local body = Instance.new("Part", car)
body.Name = "Chassis"
body.Size = Vector3.new(6, 1, 12)
body.Position = Vector3.new(0, 1.5, 0)
body.BrickColor = BrickColor.new("Bright red")
body.Anchored = true
local cabin = Instance.new("Part", car)
cabin.Name = "Cabin"
cabin.Size = Vector3.new(5, 1.8, 6)
cabin.Position = Vector3.new(0, 2.9, -1)
cabin.BrickColor = BrickColor.new("Bright red")
cabin.Anchored = true
local w1 = Instance.new("Part", car)
w1.Name = "Wheel_FL"
w1.Shape = Enum.PartType.Cylinder
w1.Size = Vector3.new(0.8, 2, 2)
w1.Position = Vector3.new(-3.4, 1, 4)
w1.BrickColor = BrickColor.new("Black")
w1.Anchored = true
local w2 = Instance.new("Part", car)
w2.Name = "Wheel_FR"
w2.Shape = Enum.PartType.Cylinder
w2.Size = Vector3.new(0.8, 2, 2)
w2.Position = Vector3.new(3.4, 1, 4)
w2.BrickColor = BrickColor.new("Black")
w2.Anchored = true
local w3 = Instance.new("Part", car)
w3.Name = "Wheel_BL"
w3.Shape = Enum.PartType.Cylinder
w3.Size = Vector3.new(0.8, 2, 2)
w3.Position = Vector3.new(-3.4, 1, -4)
w3.BrickColor = BrickColor.new("Black")
w3.Anchored = true
local w4 = Instance.new("Part", car)
w4.Name = "Wheel_BR"
w4.Shape = Enum.PartType.Cylinder
w4.Size = Vector3.new(0.8, 2, 2)
w4.Position = Vector3.new(3.4, 1, -4)
w4.BrickColor = BrickColor.new("Black")
w4.Anchored = true
local l1 = Instance.new("Part", car)
l1.Name = "Headlight_L"
l1.Shape = Enum.PartType.Ball
l1.Size = Vector3.new(0.8, 0.8, 0.8)
l1.Position = Vector3.new(-2, 1.5, 6.1)
l1.BrickColor = BrickColor.new("New Yeller")
l1.Anchored = true
local l2 = Instance.new("Part", car)
l2.Name = "Headlight_R"
l2.Shape = Enum.PartType.Ball
l2.Size = Vector3.new(0.8, 0.8, 0.8)
l2.Position = Vector3.new(2, 1.5, 6.1)
l2.BrickColor = BrickColor.new("New Yeller")
l2.Anchored = true
` },
  { id: 'snowman', name: 'Snowman', source: `local s = Instance.new("Model", workspace)
s.Name = "Snowman"
local a = Instance.new("Part", s)
a.Name = "Bottom"
a.Shape = Enum.PartType.Ball
a.Size = Vector3.new(4, 4, 4)
a.Position = Vector3.new(0, 2, 0)
a.BrickColor = BrickColor.new("White")
a.Anchored = true
local b = Instance.new("Part", s)
b.Name = "Middle"
b.Shape = Enum.PartType.Ball
b.Size = Vector3.new(3, 3, 3)
b.Position = Vector3.new(0, 5.5, 0)
b.BrickColor = BrickColor.new("White")
b.Anchored = true
local c = Instance.new("Part", s)
c.Name = "Head"
c.Shape = Enum.PartType.Ball
c.Size = Vector3.new(2, 2, 2)
c.Position = Vector3.new(0, 8, 0)
c.BrickColor = BrickColor.new("White")
c.Anchored = true
local n = Instance.new("WedgePart", s)
n.Name = "Nose"
n.Size = Vector3.new(0.4, 0.4, 1)
n.Position = Vector3.new(0, 8, 1.2)
n.BrickColor = BrickColor.new("Bright orange")
n.Anchored = true
` },
  { id: 'tree', name: 'Tree', source: `local t = Instance.new("Model", workspace)
t.Name = "Tree"
local trunk = Instance.new("Part", t)
trunk.Name = "Trunk"
trunk.Shape = Enum.PartType.Cylinder
trunk.Size = Vector3.new(8, 1.5, 1.5)
trunk.Orientation = Vector3.new(0, 0, 90)
trunk.Position = Vector3.new(0, 4, 0)
trunk.BrickColor = BrickColor.new("Reddish brown")
trunk.Anchored = true
local top = Instance.new("Part", t)
top.Name = "Leaves"
top.Shape = Enum.PartType.Ball
top.Size = Vector3.new(7, 7, 7)
top.Position = Vector3.new(0, 10, 0)
top.BrickColor = BrickColor.new("Dark green")
top.Anchored = true
` },
  { id: 'spinner', name: 'Spinning part', source: `local p = Instance.new("Part", workspace)
p.Name = "Spinner"
p.Size = Vector3.new(4, 1, 4)
p.Position = Vector3.new(0, 5, 0)
p.BrickColor = BrickColor.new("Bright blue")
p.Anchored = true
while true do
	p.Orientation = Vector3.new(0, p.Orientation.Y + 5, 0)
	wait(0.1)
end
` },
  { id: 'killbrick', name: 'Kill brick', source: `local brick = Instance.new("Part", workspace)
brick.Name = "KillBrick"
brick.Size = Vector3.new(8, 1, 8)
brick.Position = Vector3.new(0, 0.5, 0)
brick.BrickColor = BrickColor.new("Really red")
brick.Anchored = true
brick.Touched:Connect(function(hit)
	local humanoid = hit.Parent:FindFirstChild("Humanoid")
	if humanoid then
		humanoid.Health = 0
	end
end)
` },
];

export const findTemplate = id => TEMPLATES.find(t => t.id === id) || null;

const MAX_IMPORT = 200 * 1024;      // a script file bigger than this is not a Roblox script
/** A script file name -> an explorer name: "my car.v2.lua" becomes "my car v2". */
export function nameFromFile(file) {
  const base = String(file || 'Script').replace(/^.*[\\/]/, '').replace(/\.(lua|luau|txt)$/i, '').replace(/[^\w \-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (base || 'Script').slice(0, 40);
}
/** Check an uploaded file before it becomes a script. Returns { ok, name, source } or { ok:false, why }. */
export function readImport(file, text) {
  const n = String(file || '');
  if (!/\.(lua|luau|txt)$/i.test(n)) return { ok: false, why: n + ' is not a .lua, .luau or .txt file.' };
  const t = String(text == null ? '' : text);
  if (t.length > MAX_IMPORT) return { ok: false, why: n + ' is too big for a script (over 200 KB).' };
  if (/[\u0000]/.test(t)) return { ok: false, why: n + ' looks like a binary file, not text.' };
  if (!t.trim()) return { ok: false, why: n + ' is empty.' };
  return { ok: true, name: nameFromFile(n), source: t.replace(/\r\n?/g, '\n') };
}
/** Every script in one text file, each under a clear header, so one download keeps the whole project. */
export function bundle(scripts) {
  const list = (scripts || []).filter(s => s && String(s.source || '').trim());
  return list.map(s => `-- ===== ${s.name || 'Script'} =====\n${String(s.source).replace(/\s+$/, '')}\n`).join('\n');
}
/** Split a bundle made by bundle() back into scripts. A file without headers is one script. */
export function unbundle(text, fallbackName = 'Script') {
  const t = String(text || ''), re = /^-- ===== (.+?) =====\n/gm, marks = [];
  let m; while ((m = re.exec(t))) marks.push({ name: m[1], at: m.index, end: re.lastIndex });
  if (!marks.length) return t.trim() ? [{ name: fallbackName, source: t }] : [];
  return marks.map((k, i) => ({ name: k.name, source: t.slice(k.end, i + 1 < marks.length ? marks[i + 1].at : t.length).replace(/\s+$/, '') + '\n' })).filter(s => s.source.trim());
}
