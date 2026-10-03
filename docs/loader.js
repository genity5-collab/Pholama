// Llama loader: the outline stays, a filled llama rises from the bottom as the download progresses.
// Unknown progress (total = 0) shows a gentle pulse instead of a fake percentage.
const BODY = 'M33 28 C26 32 25 42 29 48 C31 52 36 55 40 56 C40 70 38 82 32 92 C28 99 27 106 28 114 L72 114 C73 106 72 99 68 92 C62 82 60 70 60 56 C64 55 69 52 71 48 C75 42 74 32 67 28 C60 24 40 24 33 28 Z';
const EARS = 'M30 6 C28 15 29 22 33 28 M70 6 C72 15 71 22 67 28';
let uid = 0;
export function llamaLoader(size = 56) {
  const id = 'll' + (++uid), h = 120;
  const el = document.createElement('span'); el.className = 'llama'; el.style.cssText = `display:inline-block;width:${size * 100 / 120}px;height:${size}px;flex:none`;
  el.innerHTML = `<svg viewBox="0 0 100 ${h}" width="100%" height="100%" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <defs><clipPath id="${id}"><path d="${BODY}"/></clipPath></defs>
    <g clip-path="url(#${id})"><g class="lv" style="transform:translateY(${h}px);transition:transform .5s ease">
      <path class="lw" d="M-100 0 Q-75 -7 -50 0 T0 0 T50 0 T100 0 T150 0 T200 0 V200 H-100 Z" fill="currentColor" opacity=".9"/></g></g>
    <path d="${EARS}" stroke="currentColor" stroke-width="5"/><path d="${BODY}" stroke="currentColor" stroke-width="5"/>
    <circle cx="42" cy="38" r="3.2" fill="currentColor"/><circle cx="58" cy="38" r="3.2" fill="currentColor"/>
    <path d="M46 47 C48 50 52 50 54 47" stroke="currentColor" stroke-width="5"/></svg>`;
  const lv = el.querySelector('.lv');
  return {
    el,
    set(frac) { // 0..1 known progress; null/undefined = unknown (pulse)
      if (frac == null || isNaN(frac)) { el.classList.add('unk'); lv.style.transform = `translateY(${h * 0.55}px)`; return; }
      el.classList.remove('unk'); const f = Math.max(0, Math.min(1, frac)); lv.style.transform = `translateY(${(h * (1 - f)).toFixed(1)}px)`;
    },
    done() { el.classList.remove('unk'); el.classList.add('ok'); lv.style.transform = 'translateY(0px)'; },
  };
}
export const LLAMA_CSS = `
.llama{color:var(--fg)}.llama .lw{animation:lwave 1.6s linear infinite}
@keyframes lwave{to{transform:translateX(-50px)}}
.llama.unk svg{animation:lpulse 1.2s ease-in-out infinite}@keyframes lpulse{50%{opacity:.35}}
.llama.ok{color:var(--ok)}
@media (prefers-reduced-motion:reduce){.llama .lw,.llama.unk svg{animation:none}}`;
