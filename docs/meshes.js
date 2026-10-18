// Part shapes as triangles/quads in the viewport's axes: x, y = ground, z = up. Each face is { v: [[x,y,z]...], n: [nx,ny,nz] } in a unit cube centred on (0,0,0)
// with size 1. The caller scales by the part size, rotates by the part's matrix, then moves it to the part's position.
const face = (v) => { // normal from the first three points
  const a = v[0], b = v[1], c = v[2], ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
  let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const l = Math.hypot(nx, ny, nz) || 1;
  return { v, n: [nx / l, ny / l, nz / l] };
};
const H = 0.5;
// Faces are listed so the winding gives an OUTWARD normal; we double check below and flip if needed.
function outward(faces) {
  return faces.map(f => { const cx = f.v.reduce((s, p) => s + p[0], 0) / f.v.length, cy = f.v.reduce((s, p) => s + p[1], 0) / f.v.length, cz = f.v.reduce((s, p) => s + p[2], 0) / f.v.length;
    const d = f.n[0] * cx + f.n[1] * cy + f.n[2] * cz; return d < 0 ? { v: [...f.v].reverse(), n: f.n.map(x => -x) } : f; });
}
const BOX = outward([
  face([[-H, -H, H], [H, -H, H], [H, H, H], [-H, H, H]]),    // top
  face([[-H, -H, -H], [-H, H, -H], [H, H, -H], [H, -H, -H]]),  // bottom
  face([[-H, -H, -H], [H, -H, -H], [H, -H, H], [-H, -H, H]]),  // -y
  face([[-H, H, -H], [-H, H, H], [H, H, H], [H, H, -H]]),      // +y
  face([[-H, -H, -H], [-H, -H, H], [-H, H, H], [-H, H, -H]]),  // -x
  face([[H, -H, -H], [H, H, -H], [H, H, H], [H, -H, H]])       // +x
]);
// A Roblox WedgePart: a ramp. The slope rises toward -Z (Roblox) and the sloped face looks up and toward +Z; here in viewport axes (x, depth, height):
// the tall edge is at the back (+depth side in Roblox terms is -Z, which is -depth... we follow Roblox: tall side at +Z of the part means +y in viewport).
const WEDGE = outward([
  face([[-H, -H, -H], [-H, H, -H], [H, H, -H], [H, -H, -H]]),                    // bottom
  face([[-H, H, -H], [-H, H, H], [H, H, H], [H, H, -H]]),                         // tall back wall (+y)
  face([[-H, -H, -H], [H, -H, -H], [H, H, H], [-H, H, H]]),                       // the slope: from the low front edge up to the tall back edge
  face([[-H, -H, -H], [-H, H, H], [-H, H, -H]]),                                  // left triangle
  face([[H, -H, -H], [H, H, -H], [H, H, H]])                                      // right triangle
]);
const CORNER = outward([
  face([[-H, -H, -H], [-H, H, -H], [H, H, -H], [H, -H, -H]]),
  face([[-H, H, -H], [-H, H, H], [H, H, -H]]),
  face([[-H, -H, -H], [H, -H, -H], [-H, H, H]]),
  face([[H, -H, -H], [H, H, -H], [-H, H, H]]),
  face([[-H, -H, -H], [-H, H, H], [-H, H, -H]])
]);
function round(seg, ends) {   // a cylinder standing along the part's X axis (Roblox Cylinder) built from `seg` sides
  const f = [];
  for (let i = 0; i < seg; i++) { const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2, y0 = Math.cos(a0) * H, z0 = Math.sin(a0) * H, y1 = Math.cos(a1) * H, z1 = Math.sin(a1) * H;
    f.push(face([[-H, y0, z0], [H, y0, z0], [H, y1, z1], [-H, y1, z1]]));
    if (ends) { f.push(face([[H, 0, 0], [H, y1, z1], [H, y0, z0]])); f.push(face([[-H, 0, 0], [-H, y0, z0], [-H, y1, z1]])); } }
  return outward(f);
}
const CYL = round(16, true);
function ball(rings, seg) {
  const f = [], P = (th, ph) => [H * Math.sin(th) * Math.cos(ph), H * Math.sin(th) * Math.sin(ph), H * Math.cos(th)];
  for (let r = 0; r < rings; r++) for (let s = 0; s < seg; s++) { const t0 = r / rings * Math.PI, t1 = (r + 1) / rings * Math.PI, p0 = s / seg * Math.PI * 2, p1 = (s + 1) / seg * Math.PI * 2;
    const q = [P(t0, p0), P(t0, p1), P(t1, p1), P(t1, p0)]; f.push(face(r === 0 ? [q[0], q[2], q[3]] : r === rings - 1 ? [q[0], q[1], q[2]] : q)); }
  return outward(f);
}
const BALL = ball(8, 14);
/** The faces of a part's shape. `type` is the Roblox class, `shape` is the Part.Shape name (Block, Ball, Cylinder, Wedge...). */
export function facesFor(type, shape) {
  const t = String(type || ''), sh = String(shape || '');
  if (t === 'WedgePart' || sh === 'Wedge') return WEDGE;
  if (t === 'CornerWedgePart' || sh === 'CornerWedge') return CORNER;
  if (sh === 'Cylinder') return CYL;
  if (sh === 'Ball') return BALL;
  return BOX;
}
export const _shapes = { BOX, WEDGE, CORNER, CYL, BALL };
