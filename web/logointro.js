// Pholama logo intro: a short animation (about 4 seconds) that plays when the app or the site opens, and inside the update scene.
// It is drawn with SVG + CSS from the real traced logo (the same vector as icon.svg), so it is tiny, sharp at any size, and follows the theme.
// Sequence (same as the video): dots gather, the llama rises, the ears and face appear, the sunglasses drop on, the name fades in.
// `plan()` is pure (no DOM) so it can be tested. Respects "reduce motion": the finished logo shows instantly, with no movement.
export const LLAMA_D = "M371.2 727.5C362.3 726.7 349.0 724.7 341.8 723.0C332.7 721.0 319.0 716.7 313.6 714.2C312.2 713.5 310.9 713.0 310.7 713.0C310.3 713.0 305.7 710.9 298.8 707.4C285.7 701.0 273.0 692.9 263.2 684.8C253.3 676.5 247.8 670.8 248.3 669.3C248.4 669.0 248.7 665.5 249.0 661.5C249.3 657.5 249.7 651.7 250.0 648.5C250.3 645.3 250.7 639.9 251.0 636.5C251.3 633.1 251.7 627.9 252.0 625.0C252.7 617.7 253.2 611.7 255.0 590.2C255.2 587.2 255.7 581.9 256.0 578.5C256.3 575.1 256.7 569.5 257.0 566.2C257.3 563.0 257.7 557.8 258.0 554.8C258.3 551.7 258.9 543.7 259.5 537.0C260.0 530.3 260.7 522.2 261.0 519.0C261.3 515.8 261.7 510.4 262.0 507.0C263.3 489.9 263.6 486.4 264.0 481.8C264.3 479.0 264.7 474.2 265.0 471.0C265.2 467.8 265.7 462.7 266.0 459.5C266.6 453.2 267.2 446.4 268.0 435.8C268.3 431.9 268.8 426.1 269.0 422.8C269.7 415.6 269.6 408.3 269.0 402.8C268.0 393.8 267.8 393.0 267.3 393.0C267.0 393.0 265.1 395.1 263.3 397.6C261.4 400.2 259.7 402.4 259.6 402.5C259.1 403.2 258.0 400.2 256.6 394.0C255.6 389.4 255.5 377.9 256.5 372.8C257.0 369.6 258.8 363.1 260.8 357.1C261.2 355.9 261.5 354.9 261.5 354.7C261.5 354.1 259.8 354.8 255.3 357.3C252.5 358.8 250.0 360.0 249.6 360.0C247.9 360.0 249.6 348.7 252.8 339.2C255.7 330.5 256.5 328.4 259.0 323.1L261.5 317.9 L259.1 314.6C253.0 306.4 250.9 299.5 248.4 279.5L247.9 274.8 L244.5 271.5C239.8 267.0 239.4 265.7 239.6 256.1C239.7 248.6 239.8 248.6 241.3 246.7C243.5 243.9 246.2 242.8 255.8 240.7C260.4 239.7 265.5 238.7 267.0 238.3L269.7 237.8 L270.8 234.5C272.3 230.3 272.4 230.5 269.5 226.3C268.2 224.3 266.6 221.9 266.1 220.9C265.6 220.0 264.2 217.8 263.1 216.0C255.2 203.0 245.9 180.8 243.0 168.0C239.1 150.8 238.8 148.6 238.8 133.0C238.8 114.8 239.6 109.0 245.0 89.2C245.2 88.4 246.1 85.8 247.0 83.5C247.9 81.2 248.9 78.2 249.3 77.0C252.4 68.1 260.0 55.2 266.5 47.8C271.6 41.9 279.9 38.7 284.7 40.7C290.3 43.0 293.1 48.3 296.5 62.8C297.3 66.3 298.6 71.7 299.3 74.8C300.6 80.1 302.4 88.9 304.6 99.5C305.1 102.4 305.8 105.5 306.0 106.5C306.6 109.3 308.6 118.6 309.0 120.8C309.7 124.3 311.6 133.2 312.0 135.1C312.3 136.1 313.0 139.3 313.5 142.1C314.6 148.0 315.4 151.9 317.5 161.8C320.7 176.2 321.1 178.0 321.5 178.3C321.8 178.4 323.5 177.8 325.4 177.0C333.0 173.4 340.5 170.8 348.5 169.0C358.3 166.7 357.5 167.1 358.5 163.7C360.6 156.2 366.8 147.3 373.5 142.3C379.4 137.9 388.0 133.8 389.0 134.8C389.5 135.3 388.8 138.1 386.0 146.5C385.2 148.9 383.4 154.9 382.7 157.6C382.3 159.1 383.5 158.6 386.5 155.9C393.4 149.8 402.1 146.0 408.8 146.0C420.9 146.2 421.7 157.6 410.1 165.6C407.5 167.4 407.4 168.0 409.9 168.0C412.1 168.0 425.6 170.7 429.2 171.8C432.7 173.0 440.9 176.2 444.1 177.7C445.5 178.4 446.7 179.0 446.8 179.0C446.9 179.0 447.9 175.0 449.0 169.2C449.6 166.2 450.5 161.8 451.1 159.5C451.6 157.2 452.2 154.1 452.5 152.8C453.3 148.8 455.6 138.0 456.0 135.8C456.7 132.8 462.5 104.7 463.1 101.8C463.4 100.4 463.8 98.3 464.0 97.2C464.7 93.3 466.0 87.2 466.5 85.2C467.8 79.9 469.5 72.4 470.2 69.0C474.0 52.1 474.8 49.5 478.0 45.1C487.6 31.8 506.3 45.8 518.0 75.2C523.0 87.7 526.6 100.9 528.6 114.0C529.4 119.8 529.5 144.8 528.6 150.2C527.1 159.3 523.8 174.2 522.5 177.2C522.3 177.8 521.6 179.7 521.0 181.5C520.4 183.3 519.7 185.2 519.5 185.8C519.3 186.3 518.6 188.0 518.0 189.5C513.8 200.1 507.0 213.1 500.2 223.6C495.6 230.7 495.6 230.6 498.1 235.8C499.0 237.8 499.3 238.0 501.9 238.5C519.7 241.9 523.1 243.0 525.8 245.8C528.4 248.4 528.7 249.8 528.4 259.1C528.2 266.8 527.6 268.3 523.3 271.5C520.7 273.5 520.3 274.5 519.5 280.8C517.1 299.7 514.9 306.9 509.3 314.3C506.6 318.0 506.6 317.5 508.7 322.1C513.8 333.1 517.3 343.4 518.5 351.5C519.7 359.7 519.5 360.9 516.9 359.3C515.0 358.1 507.8 354.5 507.3 354.5C506.8 354.5 507.0 355.4 508.5 360.2C513.3 375.8 513.8 388.1 510.2 399.6C509.2 402.7 508.7 402.6 505.8 398.5C501.2 392.1 500.3 391.7 499.8 396.4C498.3 411.0 498.3 413.8 499.5 426.8C500.5 437.9 501.2 446.7 502.5 463.0C502.8 466.7 503.2 471.9 503.5 474.5C504.0 480.1 504.8 488.2 505.5 497.2C505.8 500.8 506.2 506.3 506.5 509.5C506.8 512.7 507.2 518.1 507.5 521.5C508.7 536.7 509.0 540.6 509.5 546.1C509.8 549.4 510.2 554.6 510.5 557.9C510.8 561.1 511.2 566.6 511.5 570.0C511.8 573.4 512.2 578.7 512.5 581.8C513.0 587.3 513.6 594.5 514.5 606.0C514.8 609.4 515.2 614.5 515.5 617.2C516.5 628.0 517.0 633.5 517.5 639.8C518.3 650.4 519.0 658.4 519.6 664.6C520.2 671.6 520.8 670.5 512.5 678.2C503.7 686.4 490.9 696.0 482.0 701.1C473.9 705.7 467.4 709.0 459.0 712.6C447.4 717.7 433.5 722.0 419.8 724.5C414.4 725.6 411.4 726.0 403.2 727.0C397.5 727.7 377.1 728.0 371.2 727.5ZM393.4 406.3C402.0 404.5 410.0 399.2 410.0 395.3C410.0 393.4 409.3 393.6 402.8 396.5C391.8 401.4 377.1 401.2 364.1 395.9C358.9 393.8 358.0 393.8 358.0 395.7C358.0 398.0 364.4 403.0 369.6 404.9C375.7 407.0 386.7 407.7 393.4 406.3ZM370.6 379.5C375.7 378.4 379.3 376.8 382.1 374.1L383.9 372.4 L386.4 374.4C396.9 383.2 415.9 381.4 426.7 370.6C433.1 364.1 434.6 360.3 431.7 358.0C429.4 356.3 427.4 357.1 425.3 360.7C422.4 365.7 414.5 370.9 408.2 372.1C399.6 373.7 391.3 370.4 388.8 364.4C387.5 361.4 387.7 345.9 389.0 342.4C390.7 337.8 397.3 332.2 402.0 331.3C408.2 330.1 409.3 329.7 411.1 327.9C413.9 325.1 413.6 322.1 410.2 318.6C409.1 317.5 405.0 316.0 403.1 316.0C399.0 316.0 397.5 316.9 391.8 322.8C384.2 330.4 383.4 330.5 378.2 324.6C372.3 317.9 370.3 316.5 365.9 316.1C358.9 315.4 353.0 321.9 356.0 326.8C357.3 329.1 358.8 329.8 365.0 331.0C370.6 332.1 376.3 336.6 378.9 342.0C380.2 344.7 380.2 344.9 380.2 353.5C380.1 363.6 379.6 365.5 376.1 368.6C367.8 376.1 351.7 372.5 343.3 361.2C339.7 356.6 338.5 356.0 336.2 358.2C334.4 360.0 334.6 362.0 337.0 365.4C344.4 376.2 358.2 382.0 370.6 379.5ZM330.8 321.3C343.5 318.9 351.5 312.4 357.5 299.3C358.3 297.5 359.6 294.6 360.4 292.9C361.2 291.1 362.2 288.7 362.6 287.5C363.3 285.6 365.1 280.9 366.5 277.2C368.9 271.0 370.1 269.6 374.8 267.5C381.4 264.4 387.9 264.6 394.3 267.9C398.4 270.1 399.2 271.1 402.0 278.4C403.2 281.3 404.5 284.7 405.1 285.9C405.6 287.0 406.0 288.2 406.0 288.4C406.0 288.7 406.8 290.6 407.8 292.7C408.7 294.8 410.3 298.2 411.2 300.3C416.3 311.2 424.4 318.5 433.8 320.5C435.4 320.8 437.9 321.4 439.2 321.7C443.0 322.5 476.9 322.5 482.8 321.6C498.5 319.2 506.3 311.7 510.2 295.2C511.4 290.2 512.2 285.2 513.2 276.5C513.7 272.4 514.7 270.5 518.5 266.9L522.0 263.5 L522.0 257.3C522.0 249.2 522.3 249.5 511.5 247.2C496.4 244.0 489.8 243.4 468.8 243.1C432.1 242.7 414.2 245.5 405.5 253.1C403.0 255.4 402.8 255.4 394.0 253.8C388.4 252.8 379.9 252.8 374.2 253.8C365.2 255.5 364.9 255.4 361.6 252.7C358.0 249.6 355.7 248.4 351.2 247.1C332.6 241.8 285.0 241.6 259.2 246.7C245.8 249.4 246.0 249.2 246.0 257.7L246.0 263.7 L249.7 267.2C253.7 271.0 254.6 273.0 255.2 279.0C258.6 310.6 266.5 320.1 290.8 322.0C299.5 322.7 326.0 322.2 330.8 321.3ZM269.8 279.1C268.6 277.7 268.7 270.9 270.0 267.4C272.1 261.8 276.1 258.0 281.9 256.0C287.0 254.3 290.0 255.0 290.0 257.8C290.0 259.2 289.5 259.7 286.2 261.7C280.5 265.1 277.4 268.8 275.3 275.2C273.7 279.9 271.8 281.3 269.8 279.1ZM419.4 279.2C419.0 278.6 418.8 277.0 418.8 273.8C418.9 264.6 424.5 257.7 433.9 255.5C437.1 254.8 438.6 255.1 439.5 256.7C440.4 258.4 439.4 259.9 435.9 261.9C430.0 265.3 425.9 270.5 424.8 276.0C424.0 279.7 421.2 281.4 419.4 279.2ZM286.3 207.4C288.2 205.1 291.0 201.9 292.6 200.2L295.5 197.1 L294.3 191.4C292.6 183.7 292.1 178.8 291.5 161.0C290.4 126.3 289.9 118.5 287.7 101.2C285.7 84.8 283.9 75.8 281.7 69.9C279.9 65.3 278.1 64.8 275.2 68.2C273.4 70.2 272.8 71.2 269.5 77.2C265.1 85.6 261.1 97.5 257.5 113.2C257.0 115.6 256.3 121.0 255.4 129.4C253.1 153.3 263.2 186.2 279.7 208.1C281.1 210.0 282.4 211.5 282.6 211.5C282.7 211.5 284.4 209.6 286.3 207.4ZM490.1 206.1C494.9 199.2 499.7 190.6 502.2 184.2C503.0 182.3 503.9 180.1 504.3 179.2C506.1 175.2 508.1 168.4 510.0 160.5C513.3 146.1 513.7 132.6 511.2 117.1C510.3 111.6 507.0 97.9 506.4 97.3C506.2 97.0 506.0 96.4 506.0 95.9C506.0 93.6 500.2 80.0 496.4 73.4C493.4 68.1 491.5 66.0 489.8 66.0C486.4 66.0 483.5 76.6 480.6 99.2C478.5 115.0 478.2 120.1 476.5 165.0C476.0 177.7 475.2 185.4 474.0 191.0C472.6 197.0 472.6 196.9 476.3 200.8C478.1 202.7 480.8 205.9 482.4 207.9C484.0 209.9 485.5 211.5 485.8 211.5C486.1 211.5 488.0 209.1 490.1 206.1Z";
export const VB = 768, CROP = { x: 200, y: 20, w: 368, h: 728 };   // the llama sits in x 238-529, y 40-727; this frame leaves even room around it
export const GLASSES = { y0: 240, y1: 338 };                        // the sunglasses band of the logo, used to reveal them on their own

// Timeline in milliseconds. Every stage starts after the one before it, so the order can never be scrambled.
export const TIMES = { dots: 0, rise: 900, face: 1800, glasses: 2700, name: 3300, end: 4200 };
export function plan({ reduced = false, fast = false } = {}) {
  if (reduced) return { reduced: true, total: 0, stages: [] };
  const k = fast ? 0.55 : 1, t = n => Math.round(TIMES[n] * k);
  const stages = ['dots', 'rise', 'face', 'glasses', 'name'].map(n => ({ name: n, at: t(n) }));
  return { reduced: false, total: t('end'), stages };
}
export function stageAt(p, ms) { let cur = p.stages.length ? p.stages[0].name : 'done'; for (const s of p.stages) if (ms >= s.at) cur = s.name; return ms >= p.total ? 'done' : cur; }

const DOTS = [[-62, -70, 7], [40, -34, 5.5], [-96, -12, 9], [-72, 44, 6], [78, 50, 6.5], [-6, 92, 4], [10, -112, 3.5], [96, -78, 4.5], [-30, 118, 5], [-110, 76, 4]];

// Builds the scene markup. Pure string, no DOM. `id` keeps gradient and clip ids unique when two scenes exist at once.
export function sceneHTML(id = 'pl', { name = true } = {}) {
  const dots = DOTS.map(([x, y, r], i) => `<circle class="pi-dot" cx="${384 + x}" cy="${384 + y}" r="${r}" style="--dx:${-x}px;--dy:${-y}px;animation-delay:${(i % 5) * 60}ms"/>`).join('');
  return `<div class="pi" data-stage="dots"><svg viewBox="${CROP.x} ${CROP.y} ${CROP.w} ${CROP.h}" role="img" aria-label="Pholama llama logo" preserveAspectRatio="xMidYMid meet">
    <defs>
      <path id="${id}-p" fill-rule="evenodd" d="${LLAMA_D}"/>
      <clipPath id="${id}-rise"><rect class="pi-wipe" x="0" y="0" width="${VB}" height="${VB}"/></clipPath>
      <clipPath id="${id}-glass"><rect x="0" y="${GLASSES.y0}" width="${VB}" height="${GLASSES.y1 - GLASSES.y0}"/></clipPath>
    </defs>
    <g class="pi-dots">${dots}</g>
    <g class="pi-llama" clip-path="url(#${id}-rise)">
      <use class="pi-shape" href="#${id}-p"/>
      <g class="pi-bare"><rect x="236" y="${GLASSES.y0 - 2}" width="296" height="${GLASSES.y1 - GLASSES.y0 + 6}" class="pi-skin"/><circle class="pi-eye" cx="326" cy="286" r="9"/><circle class="pi-eye" cx="442" cy="286" r="9"/></g>
    </g>
    <g class="pi-glasses" clip-path="url(#${id}-glass)"><use class="pi-shape" href="#${id}-p"/></g>
  </svg>${name ? '<div class="pi-name" aria-hidden="true">PHOLAMA</div>' : ''}</div>`;
}

// CSS for the intro and for the full-screen splash. Uses theme variables, so light and dark both look right.
export const INTRO_CSS = `
.pi{display:flex;flex-direction:column;align-items:center;gap:14px;color:var(--fg);--skin:var(--fg)}
.pi svg{width:min(46vmin,260px);height:auto;overflow:visible}
.pi-shape{fill:currentColor}.pi-skin{fill:var(--skin)}.pi-eye{fill:var(--bg)}
.pi-dot{fill:currentColor;opacity:0;transform-box:fill-box;transform-origin:center;animation:pi-dot 1s ease-in-out both}
@keyframes pi-dot{0%{opacity:0;scale:.5}30%{opacity:1;scale:1}75%{opacity:1}100%{opacity:0;translate:var(--dx) var(--dy);scale:.4}}
.pi-wipe{y:${VB}px;animation:pi-rise .9s cubic-bezier(.3,.6,.3,1) .9s both}
@keyframes pi-rise{from{y:${VB}px}to{y:0px}}
.pi-bare{opacity:1;animation:pi-bare .01s linear 3.0s forwards}@keyframes pi-bare{to{opacity:0}}
.pi-glasses{opacity:0;translate:0 -70px;animation:pi-drop .55s cubic-bezier(.3,1.5,.5,1) 2.7s forwards}
@keyframes pi-drop{60%{opacity:1}to{opacity:1;translate:0 0}}
.pi-name{letter-spacing:.32em;font-weight:650;font-size:clamp(15px,3.6vmin,22px);opacity:0;translate:0 6px;animation:pi-name .7s ease 3.3s forwards;padding-left:.32em}
@keyframes pi-name{to{opacity:.85;translate:0 0}}
.pi.fast .pi-dot{animation-duration:.5s}.pi.fast .pi-wipe{animation-duration:.5s;animation-delay:.5s}.pi.fast .pi-bare{animation-delay:1.65s}.pi.fast .pi-glasses{animation-duration:.3s;animation-delay:1.5s}.pi.fast .pi-name{animation-duration:.4s;animation-delay:1.8s}
.pi.still .pi-dot,.pi.still .pi-bare{display:none}.pi.still .pi-wipe,.pi.still .pi-glasses,.pi.still .pi-name{animation:none;opacity:1;translate:0 0;transform:none}.pi.still .pi-wipe{y:0px}.pi.still .pi-name{opacity:.85}
@media (prefers-reduced-motion:reduce){.pi .pi-dot,.pi .pi-bare{display:none}.pi .pi-wipe,.pi .pi-llama,.pi .pi-glasses,.pi .pi-name{animation:none;opacity:1;translate:0 0;transform:none}.pi .pi-wipe{y:0px}.pi .pi-name{opacity:.85}}
.plogo{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:var(--bg);transition:opacity .45s ease,visibility .45s}
.plogo.out{opacity:0;visibility:hidden;pointer-events:none}
`;

let cssDone = false;
export function ensureCSS() { if (cssDone || typeof document === 'undefined') return; cssDone = true; const s = document.createElement('style'); s.id = 'piCss'; s.textContent = INTRO_CSS; document.head.appendChild(s); }
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// The full-screen splash. Shows the animation, then fades away. Returns a promise that resolves when it is gone.
// It can always be skipped (click, tap, Escape or Enter), and it never traps the page: a safety timer removes it no matter what.
export function playSplash({ fast = false, host = document.body, onDone } = {}) {
  ensureCSS();
  const red = reducedMotion(), p = plan({ reduced: red, fast });
  const o = document.createElement('div'); o.className = 'plogo'; o.id = 'plogo'; o.setAttribute('role', 'presentation'); o.innerHTML = sceneHTML('ps');
  const pi = o.querySelector('.pi'); if (fast) pi.classList.add('fast'); if (red) pi.classList.add('still');
  host.appendChild(o);
  return new Promise(resolve => {
    let gone = false;
    const finish = () => { if (gone) return; gone = true; document.removeEventListener('keydown', onKey); o.classList.add('out'); setTimeout(() => { o.remove(); if (onDone) try { onDone(); } catch {} resolve(); }, 480); };
    const onKey = e => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') finish(); };
    o.addEventListener('click', finish); document.addEventListener('keydown', onKey);
    const hold = red ? 700 : p.total + 450;      // a short pause on the finished logo, then away
    setTimeout(finish, hold); setTimeout(finish, hold + 3000);   // safety: it can never stay on screen
  });
}

// Small version for inside a card (the update scene). It replays by itself every few seconds while the update runs.
export function mountLogo(el, { loop = true } = {}) {
  ensureCSS(); const red = reducedMotion(); el.innerHTML = sceneHTML('pm' + Math.random().toString(36).slice(2, 6), { name: false });
  const pi = el.querySelector('.pi'); if (red) { pi.classList.add('still'); return { stop() {}, replay() {} }; }
  pi.classList.add('fast');
  let timer = 0; const replay = () => { const c = pi.cloneNode(true); pi.replaceWith(c); };
  if (loop) timer = setInterval(() => { const cur = el.querySelector('.pi'); if (!cur) return clearInterval(timer); const c = cur.cloneNode(true); cur.replaceWith(c); }, 3400);
  return { stop() { clearInterval(timer); }, replay };
}
