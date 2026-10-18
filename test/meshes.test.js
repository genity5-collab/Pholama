// The 3D shapes and the rotation maths must match Roblox, otherwise models look wrong in the viewport.
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 250))); if (!c) bad++; };
(async () => {
  const M = await import('../docs/meshes.js'), F = await import('../docs/luaflatten.js');
  const world = src => F.flatten(src).parts;
  const verts = (p) => { const R = p.rot, [sx, sy, sz] = p.size, [px, py, pz] = p.position, set = new Map();
    for (const f of M.facesFor(p.type, p.shape)) for (const v of f.v) { const x = v[0] * sx, y = v[1] * sy, z = v[2] * sz; const w = [R[0] * x + R[1] * y + R[2] * z + px, R[3] * x + R[4] * y + R[5] * z + py, R[6] * x + R[7] * y + R[8] * z + pz].map(n => +n.toFixed(3)); set.set(w.join(), w); }
    return [...set.values()]; };
  const ext = vs => ({ x: [Math.min(...vs.map(v => v[0])), Math.max(...vs.map(v => v[0]))], y: [Math.min(...vs.map(v => v[1])), Math.max(...vs.map(v => v[1]))], z: [Math.min(...vs.map(v => v[2])), Math.max(...vs.map(v => v[2]))] });
  for (const [k, f] of Object.entries(M._shapes)) {
    let inward = 0; for (const q of f) { const c = q.v.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map(x => x / q.v.length); if (q.n[0] * c[0] + q.n[1] * c[1] + q.n[2] * c[2] < -1e-9) inward++; }
    ok(`${k}: every face points outward`, inward === 0);
  }
  // a plain block
  let p = world('local p = Instance.new("Part", workspace)\np.Size = Vector3.new(4, 2, 6)\np.Position = Vector3.new(10, 5, 20)')[0];
  let e = ext(verts(p)); ok('a block fills exactly its size, centred on its position (x 8..12, y(up) 4..6, depth 17..23)', JSON.stringify([e.x, e.z, e.y]) === JSON.stringify([[8, 12], [4, 6], [17, 23]]) || (e.x[0] === 8 && e.x[1] === 12 && Math.abs(e.z[0] - 4) < 1e-6 && Math.abs(e.z[1] - 6) < 1e-6 && e.y[0] === 17 && e.y[1] === 23), JSON.stringify(e));
  // rotation: turning a 10 x 2 x 4 block 90 degrees about Y swaps its x and depth extents, and leaves its height
  p = world('local p = Instance.new("Part", workspace)\np.Size = Vector3.new(10, 2, 4)\np.CFrame = CFrame.new(0, 5, 0) * CFrame.Angles(0, math.rad(90), 0)')[0];
  e = ext(verts(p)); ok('CFrame.Angles(0, 90deg, 0) turns a 10x4 footprint into 4x10', Math.abs((e.x[1] - e.x[0]) - 4) < 0.01 && Math.abs((e.y[1] - e.y[0]) - 10) < 0.01 && Math.abs((e.z[1] - e.z[0]) - 2) < 0.01, JSON.stringify(e));
  p = world('local p = Instance.new("Part", workspace)\np.Size = Vector3.new(10, 2, 4)\np.Position = Vector3.new(0, 5, 0)\np.Orientation = Vector3.new(0, 90, 0)')[0];
  e = ext(verts(p)); ok('Orientation = (0,90,0) does the same turn', Math.abs((e.x[1] - e.x[0]) - 4) < 0.01 && Math.abs((e.y[1] - e.y[0]) - 10) < 0.01, JSON.stringify(e));
  // tipping a block over (rotate 90 about Z) makes it tall instead of wide: height becomes the old width
  p = world('local p = Instance.new("Part", workspace)\np.Size = Vector3.new(10, 2, 4)\np.CFrame = CFrame.new(0, 5, 0) * CFrame.Angles(0, 0, math.rad(90))')[0];
  e = ext(verts(p)); ok('CFrame.Angles(0,0,90deg) tips a flat plank up on its end (height 10)', Math.abs((e.z[1] - e.z[0]) - 10) < 0.01 && Math.abs((e.x[1] - e.x[0]) - 2) < 0.01, JSON.stringify(e));
  ok('a rotated part keeps its centre where it was put', Math.abs((e.x[0] + e.x[1]) / 2) < 0.01 && Math.abs((e.z[0] + e.z[1]) / 2 - 5) < 0.01, JSON.stringify(e));
  // composition: CFrame.new(p) * CFrame.Angles(...) then another turn
  p = world('local p = Instance.new("Part", workspace)\np.Size = Vector3.new(10, 2, 4)\np.CFrame = CFrame.new(3, 5, 0) * CFrame.Angles(0, math.rad(90), 0) * CFrame.Angles(0, math.rad(90), 0)')[0];
  e = ext(verts(p)); ok('two quarter turns make a half turn: same footprint again (10 wide), centre still at x=3', Math.abs((e.x[1] - e.x[0]) - 10) < 0.01 && Math.abs((e.x[0] + e.x[1]) / 2 - 3) < 0.01, JSON.stringify(e));
  // a wedge: one tall edge, one low edge. Unrotated, the tall edge is at the back (positive Roblox -Z... checked by symmetry: heights differ across depth only)
  p = world('local w = Instance.new("WedgePart", workspace)\nw.Size = Vector3.new(4, 6, 8)\nw.Position = Vector3.new(0, 3, 0)')[0];
  let vs = verts(p), top = vs.filter(v => v[2] > 5.99), bottom = vs.filter(v => v[2] < 0.01);
  ok('a wedge has its tall edge on ONE side (2 top corners) and a full base (4 corners)', top.length === 2 && bottom.length === 4, JSON.stringify([top.length, bottom.length]));
  ok('the two tall corners share the same depth (they form one edge along x)', top.length === 2 && Math.abs(top[0][1] - top[1][1]) < 1e-6 && Math.abs(top[0][0] - top[1][0]) > 3.9, JSON.stringify(top));
  p = world('local w = Instance.new("WedgePart", workspace)\nw.Size = Vector3.new(4, 6, 8)\nw.CFrame = CFrame.new(0, 3, 0) * CFrame.Angles(0, math.rad(90), 0)')[0];
  vs = verts(p); top = vs.filter(v => v[2] > 5.99);
  ok('turning the wedge 90 degrees moves its tall edge to a different side (now along depth)', top.length === 2 && Math.abs(top[0][0] - top[1][0]) < 1e-6 && Math.abs(top[0][1] - top[1][1]) > 3.9, JSON.stringify(top));
  // a ball and a cylinder
  p = world('local b = Instance.new("Part", workspace)\nb.Shape = Enum.PartType.Ball\nb.Size = Vector3.new(6, 6, 6)\nb.Position = Vector3.new(0, 3, 0)')[0];
  ok('Shape = Ball is drawn as a round mesh (many faces)', M.facesFor(p.type, p.shape).length > 50, p.shape);
  e = ext(verts(p)); ok('and stays inside its 6 stud box', e.x[1] - e.x[0] <= 6.001 && e.z[1] - e.z[0] <= 6.001, JSON.stringify(e));
  ok('Shape = Cylinder is drawn as a cylinder', M.facesFor('Part', 'Cylinder').length === 48);
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
