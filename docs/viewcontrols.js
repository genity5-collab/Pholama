// Viewport controls: mouse wheel and pinch to zoom (toward the pointer), drag to turn the view, right-drag / shift-drag / two fingers to slide it,
// double-click to reset, and +, -, Fit buttons for phones and trackpads. It only moves a camera object and asks for a redraw; it never touches Lua.
import { DEFAULT_CAMERA, clampCamera, zoomCamera } from './retrostudio.js';

export function attachViewControls(canvas, { getCamera, setCamera, redraw, fit } = {}) {
  if (!canvas || !canvas.addEventListener) return { detach() {}, zoomBy() {}, reset() {} };
  let cam = clampCamera(getCamera ? getCamera() : DEFAULT_CAMERA);
  const set = c => { cam = clampCamera(c); if (setCamera) setCamera(cam); if (redraw) redraw(cam); };
  const size = () => { const r = canvas.getBoundingClientRect(); return { w: r.width || 700, h: r.height || 420, l: r.left || 0, t: r.top || 0 }; };
  const zoomAt = (factor, clientX, clientY) => { const s = size(); set(zoomCamera(cam, factor, (clientX ?? s.l + s.w / 2) - s.l, (clientY ?? s.t + s.h / 2) - s.t, s.w, s.h)); };
  const reset = () => set(fit ? fit() : DEFAULT_CAMERA);

  const pointers = new Map(); let last = null, pinch = null, moved = 0;
  const onWheel = e => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;   // lines or pages -> pixels
    const k = Math.exp(-Math.max(-150, Math.min(150, dy)) * (e.ctrlKey ? 0.008 : 0.0009));          // one mouse notch (100) is about 9%
    zoomAt(k, e.clientX, e.clientY);
  };
  const onDown = e => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0;
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; }
    last = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey || e.button === 1 };
    canvas.style.cursor = 'grabbing';
  };
  const onMove = e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2 && pinch) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y) || 1, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const s = size(); let next = zoomCamera(cam, d / pinch.d, mx - s.l, my - s.t, s.w, s.h);
      next = clampCamera({ ...next, panX: next.panX + (mx - pinch.mx), panY: next.panY + (my - pinch.my) });   // two fingers also slide the view
      pinch = { d, mx, my }; set(next); moved += 10; return;
    }
    if (!last) return;
    const dx = e.clientX - last.x, dy = e.clientY - last.y; last.x = e.clientX; last.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
    if (last.pan) set({ ...cam, panX: cam.panX + dx, panY: cam.panY + dy });
    else set({ ...cam, yaw: cam.yaw - dx * 0.008, panY: cam.panY + dy * 0.0 });   // drag sideways to turn the scene
  };
  const onUp = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; if (!pointers.size) { last = null; canvas.style.cursor = 'grab'; } try { canvas.releasePointerCapture(e.pointerId); } catch {} };
  const onDbl = () => reset();
  const onCtx = e => e.preventDefault();
  const onKey = e => {
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(1.25); } else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomAt(0.8); }
    else if (e.key === '0') { e.preventDefault(); reset(); } else if (e.key === 'ArrowLeft') { e.preventDefault(); set({ ...cam, yaw: cam.yaw + 0.15 }); } else if (e.key === 'ArrowRight') { e.preventDefault(); set({ ...cam, yaw: cam.yaw - 0.15 }); }
  };
  canvas.style.touchAction = 'none'; canvas.style.cursor = 'grab'; canvas.tabIndex = 0;
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('dblclick', onDbl); canvas.addEventListener('contextmenu', onCtx); canvas.addEventListener('keydown', onKey);
  return {
    zoomBy: f => zoomAt(f), reset, get camera() { return cam; },
    detach() { canvas.removeEventListener('wheel', onWheel); canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp); canvas.removeEventListener('dblclick', onDbl); canvas.removeEventListener('contextmenu', onCtx); canvas.removeEventListener('keydown', onKey); }
  };
}
