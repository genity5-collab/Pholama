// The viewport camera: zoom, turn and slide must work, stay in range, and keep the thing under the pointer under the pointer.
let bad = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + String(x).slice(0, 300))); if (!c) bad++; };
(async () => {
  const R = await import('../docs/retrostudio.js'); const { attachViewControls } = await import('../docs/viewcontrols.js');
  const { clampCamera, zoomCamera, DEFAULT_CAMERA, CAMERA_LIMITS } = R;
  ok('the default camera is neutral', DEFAULT_CAMERA.zoom === 1 && DEFAULT_CAMERA.yaw === 0 && DEFAULT_CAMERA.panX === 0);
  ok('zoom is kept inside its limits', clampCamera({ zoom: 999 }).zoom === CAMERA_LIMITS.maxZoom && clampCamera({ zoom: 0.0001 }).zoom === CAMERA_LIMITS.minZoom);
  ok('garbage becomes a safe camera', (() => { const c = clampCamera({ zoom: NaN, yaw: Infinity, panX: 'x', panY: null }); return c.zoom === 1 && c.yaw === 0 && c.panX === 0 && c.panY === 0; })());
  ok('yaw wraps around a full turn', Math.abs(clampCamera({ yaw: Math.PI * 2 + 1 }).yaw - 1) < 1e-9 && clampCamera({ yaw: -1 }).yaw > 0);
  ok('zooming in makes it bigger, zooming out smaller', zoomCamera(DEFAULT_CAMERA, 2, 350, 260, 700, 420).zoom === 2 && zoomCamera(DEFAULT_CAMERA, 0.5, 350, 260, 700, 420).zoom === 0.5);
  ok('zoom never passes the limits however hard you scroll', (() => { let c = DEFAULT_CAMERA; for (let i = 0; i < 100; i++) c = zoomCamera(c, 1.5, 100, 100, 700, 420); const hi = c.zoom; for (let i = 0; i < 200; i++) c = zoomCamera(c, 0.5, 100, 100, 700, 420); return hi === CAMERA_LIMITS.maxZoom && c.zoom === CAMERA_LIMITS.minZoom; })());
  ok('zooming at the centre does not slide the view', (() => { const c = zoomCamera(DEFAULT_CAMERA, 2, 350, 420 * 0.62, 700, 420); return Math.abs(c.panX) < 1e-9 && Math.abs(c.panY) < 1e-9; })());
  ok('zooming at a corner keeps that point fixed (zoom toward the pointer)', (() => {
    const w = 700, h = 420, px = 600, py = 100, c0 = DEFAULT_CAMERA, c1 = zoomCamera(c0, 2, px, py, w, h), cx = w / 2, cy = h * 0.62;
    // a scene point at screen offset (px-cx, py-cy) from the centre must land on the same pixel after zooming
    const before = [px - cx - c0.panX, py - cy - c0.panY], after = [(px - cx - c1.panX) / c1.zoom, (py - cy - c1.panY) / c1.zoom]; return Math.abs(before[0] - after[0] * 1) < 1e-6 && Math.abs(before[1] - after[1] * 1) < 1e-6; })());

  // drawing: a fake canvas that records what is drawn, so the camera is proven to change the picture
  const mk = () => { const calls = []; const ctx = new Proxy({ calls }, { get: (t, k) => k === 'calls' ? calls : (k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : typeof k === 'string' ? (...a) => { calls.push([k, ...a]); } : undefined), set: () => true }); return { ctx, getContext: () => ctx, getBoundingClientRect: () => ({ width: 700, height: 420 }), width: 0, height: 0 }; };
  const parts = [{ name: 'a', type: 'Part', size: [2, 2, 2], position: [0, 0, 0], color: [200, 50, 50], material: 'Plastic' }, { name: 'b', type: 'Part', size: [2, 2, 2], position: [6, 0, 0], color: [50, 200, 50], material: 'Plastic' }];
  const xs = cam => { const cv = mk(); R.drawPreview(cv, parts, undefined, cam); const m = cv.ctx.calls.filter(c => c[0] === 'moveTo').map(c => c[1]); return { min: Math.min(...m), max: Math.max(...m), n: m.length }; };
  const base = xs(DEFAULT_CAMERA), zin = xs({ zoom: 3 }), zout = xs({ zoom: 0.4 });
  ok('zooming in spreads the scene out wider', (zin.max - zin.min) > (base.max - base.min) * 1.5, JSON.stringify([base, zin]));
  ok('zooming out pulls the scene in', (zout.max - zout.min) < (base.max - base.min) * 0.7, JSON.stringify([base, zout]));
  ok('sliding the view moves the picture', xs({ panX: 120 }).min > base.min + 100);
  ok('turning the view changes the picture', JSON.stringify(xs({ yaw: 1.2 })) !== JSON.stringify(base));
  ok('drawing with no camera still works (old callers)', (() => { const cv = mk(); return R.drawPreview(cv, parts) === true; })());
  ok('drawing nothing works', (() => { const cv = mk(); return R.drawPreview(cv, []) === true; })());
  ok('a big model still fits at zoom 1 (auto framing)', (() => { const big = [{ name: 'w', type: 'Part', size: [60, 2, 60], position: [0, 0, 0], color: [100, 100, 100], material: 'Plastic' }]; const cv = mk(); R.drawPreview(cv, big, undefined, DEFAULT_CAMERA); const m = cv.ctx.calls.filter(c => c[0] === 'moveTo').map(c => c[1]); return Math.min(...m) > -700 && Math.max(...m) < 1400; })());

  // controls: fake canvas that records listeners so wheel / drag / pinch / keys can be fired
  const fire = () => { const L = {}; const cv = { style: {}, listeners: L, addEventListener: (t, f) => { (L[t] = L[t] || []).push(f); }, removeEventListener: (t, f) => { L[t] = (L[t] || []).filter(x => x !== f); }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 700, height: 420 }), setPointerCapture() {}, releasePointerCapture() {} };
    const ev = (t, o = {}) => { const e = { preventDefault() { e.prevented = true; }, button: 0, pointerId: 1, clientX: 0, clientY: 0, ...o }; (L[t] || []).forEach(f => f(e)); return e; }; return { cv, ev }; };
  let cam = { ...DEFAULT_CAMERA }, draws = 0; const { cv, ev } = fire();
  const ctl = attachViewControls(cv, { getCamera: () => cam, setCamera: c => { cam = c; }, redraw: () => { draws++; } });
  ok('the canvas will not scroll the page on touch (touch-action none) and shows a grab cursor', cv.style.touchAction === 'none' && cv.style.cursor === 'grab');
  let e = ev('wheel', { deltaY: -200, clientX: 350, clientY: 260 });
  ok('wheel up zooms in, blocks the page scroll and redraws', cam.zoom > 1 && e.prevented && draws === 1, JSON.stringify([cam, e.prevented, draws]));
  const z1 = cam.zoom; ev('wheel', { deltaY: 400, clientX: 350, clientY: 260 });
  ok('wheel down zooms out', cam.zoom < z1);
  for (let i = 0; i < 80; i++) ev('wheel', { deltaY: -300 });
  ok('wheel cannot zoom past the limit', cam.zoom === CAMERA_LIMITS.maxZoom);
  ctl.reset(); ok('reset puts the camera back', cam.zoom === 1 && cam.yaw === 0 && cam.panX === 0);
  ev('pointerdown', { clientX: 300, clientY: 200 }); ev('pointermove', { clientX: 360, clientY: 200 }); ev('pointerup', {});
  ok('dragging sideways turns the view', cam.yaw !== 0, JSON.stringify(cam));
  ctl.reset(); ev('pointerdown', { clientX: 300, clientY: 200, button: 2 }); ev('pointermove', { clientX: 340, clientY: 230, button: 2 }); ev('pointerup', {});
  ok('right-drag slides the view', cam.panX === 40 && cam.panY === 30, JSON.stringify(cam));
  ctl.reset(); ev('pointerdown', { clientX: 300, clientY: 200, shiftKey: true }); ev('pointermove', { clientX: 310, clientY: 200, shiftKey: true }); ev('pointerup', {});
  ok('shift-drag slides the view (no right button needed)', cam.panX === 10);
  ctl.reset(); ev('pointerdown', { pointerId: 1, clientX: 300, clientY: 200 }); ev('pointerdown', { pointerId: 2, clientX: 400, clientY: 200 });
  ev('pointermove', { pointerId: 2, clientX: 500, clientY: 200 });
  ok('two fingers moving apart zoom in (pinch)', cam.zoom > 1, JSON.stringify(cam));
  ev('pointermove', { pointerId: 2, clientX: 320, clientY: 200 });
  ok('two fingers moving together zoom out', cam.zoom < 2);
  ev('pointerup', { pointerId: 1 }); ev('pointerup', { pointerId: 2 });
  ctl.reset(); const zb = cam.zoom; ctl.zoomBy(1.3); ok('the + button path zooms in', cam.zoom > zb); ctl.zoomBy(1 / 1.3); ok('the - button path zooms back out', Math.abs(cam.zoom - zb) < 1e-9);
  ev('dblclick'); ok('double-click resets', cam.zoom === 1);
  ev('keydown', { key: '+' }); ok('the + key zooms in', cam.zoom > 1); ev('keydown', { key: '0' }); ok('the 0 key resets', cam.zoom === 1);
  ev('keydown', { key: 'ArrowLeft' }); ok('arrow keys turn the view', cam.yaw > 0);
  e = ev('contextmenu'); ok('right-click does not open the browser menu over the viewport', e.prevented);
  ctl.detach(); const before = cam.zoom; ev('wheel', { deltaY: -300 }); ok('after detach the canvas ignores input', cam.zoom === before);
  ok('attaching to nothing is harmless', (() => { try { attachViewControls(null, {}); attachViewControls({}, {}); return true; } catch { return false; } })());
  console.log(bad ? bad + ' FAILED' : 'ALL PASSED'); process.exit(bad ? 1 : 0);
})();
