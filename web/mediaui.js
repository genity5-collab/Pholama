import { mediaProblem, isVideoPath, isVideoType, IMAGE_TYPES, VIDEO_TYPES } from './social.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const btn = (label, fn, cls) => {
  const b = el('button', cls || '', label);
  b.type = 'button';
  if (fn) b.onclick = fn;
  return b;
};

function formatSize(bytes) {
  if (!(bytes > 0)) return '0 KB';
  if (bytes >= 1024 * 1024) {
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
  const kb = Math.round(bytes / 1024);
  return kb < 1 ? '< 1 KB' : kb + ' KB';
}

export function attachPicker(opts = {}) {
  const { accept = 'both', onChange, onError } = opts;
  const isImageOnly = accept === 'image';

  const acceptAttr = isImageOnly
    ? IMAGE_TYPES.join(',')
    : [...IMAGE_TYPES, ...VIDEO_TYPES].join(',');

  const btnLabel = isImageOnly ? 'Add picture' : 'Add picture or video';

  let currentFile = null;
  let objectUrl = null;

  const node = el('div', 'pmed-picker');

  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.accept = acceptAttr;
  fileInput.style.display = 'none';

  const addBtn = btn(btnLabel, () => fileInput.click(), 'pmed-btn');
  node.append(addBtn, fileInput);

  function clearState(notify = true) {
    if (objectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      try { URL.revokeObjectURL(objectUrl); } catch {}
    }
    objectUrl = null;
    currentFile = null;
    fileInput.value = '';

    node.textContent = '';
    addBtn.style.display = '';
    node.append(addBtn, fileInput);

    if (notify && typeof onChange === 'function') {
      try { onChange(null); } catch {}
    }
  }

  function handleFile(file) {
    if (!file) return;

    let prob = mediaProblem(file);
    if (!prob && isImageOnly && (isVideoType(file.type) || isVideoPath(file.name))) {
      prob = 'Use a PNG, JPG, WebP or GIF picture.';
    }

    if (prob) {
      clearState(false);
      if (typeof onError === 'function') {
        try { onError(prob); } catch {}
      }
      return;
    }

    if (objectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      try { URL.revokeObjectURL(objectUrl); } catch {}
    }

    currentFile = file;
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      try { objectUrl = URL.createObjectURL(file); } catch { objectUrl = null; }
    } else {
      objectUrl = null;
    }

    node.textContent = '';
    const previewBox = el('div', 'pmed-preview');

    const isVid = isVideoType(file.type) || isVideoPath(file.name);
    let thumb;
    if (isVid) {
      thumb = el('video', 'pmed-thumb-video');
      thumb.muted = true;
      thumb.controls = true;
      thumb.preload = 'metadata';
      if (objectUrl) thumb.src = objectUrl;
    } else {
      thumb = el('img', 'pmed-thumb-img');
      thumb.alt = file.name || 'Preview';
      if (objectUrl) thumb.src = objectUrl;
    }

    const infoBox = el('div', 'pmed-info');
    const nameSpan = el('span', 'pmed-filename', file.name || 'file');
    const sizeSpan = el('span', 'pmed-filesize', formatSize(file.size));
    infoBox.append(nameSpan, sizeSpan);

    const removeBtn = btn('Remove', () => clearState(true), 'pmed-remove-btn');

    previewBox.append(thumb, infoBox, removeBtn);
    node.append(previewBox, fileInput);

    if (typeof onChange === 'function') {
      try { onChange(currentFile); } catch {}
    }
  }

  fileInput.onchange = () => {
    if (fileInput.files && fileInput.files[0]) {
      handleFile(fileInput.files[0]);
    }
  };

  node.addEventListener('dragover', (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (e && e.stopPropagation) e.stopPropagation();
    node.classList.add('pmed-dragover');
  });
  node.addEventListener('dragenter', (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (e && e.stopPropagation) e.stopPropagation();
    node.classList.add('pmed-dragover');
  });
  node.addEventListener('dragleave', (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (e && e.stopPropagation) e.stopPropagation();
    node.classList.remove('pmed-dragover');
  });
  node.addEventListener('drop', (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (e && e.stopPropagation) e.stopPropagation();
    node.classList.remove('pmed-dragover');
    if (e && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  return {
    node,
    get: () => currentFile,
    clear: () => clearState(true)
  };
}

export function mediaView(src, opts = {}) {
  if (typeof src !== 'string' || (!src.startsWith('https://') && !src.startsWith('blob:'))) {
    return el('span');
  }

  const { video = false, alt = '' } = opts;
  const isVid = !!video || isVideoPath(src);

  if (isVid) {
    const v = el('video', 'pmed-video');
    v.controls = true;
    v.preload = 'metadata';
    v.setAttribute('playsinline', '');
    v.playsInline = true;
    v.src = src;

    v.onerror = () => {
      const err = el('span', 'pmed-error pmed-muted', 'Could not load this file.');
      if (v.parentNode) v.parentNode.replaceChild(err, v);
      else if (typeof v.replaceWith === 'function') v.replaceWith(err);
    };

    return v;
  }

  const img = el('img', 'pmed-img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.setAttribute('referrerpolicy', 'no-referrer');
  img.referrerPolicy = 'no-referrer';
  img.alt = typeof alt === 'string' ? alt : '';
  img.src = src;

  img.onerror = () => {
    const err = el('span', 'pmed-error pmed-muted', 'Could not load this file.');
    if (img.parentNode) img.parentNode.replaceChild(err, img);
    else if (typeof img.replaceWith === 'function') img.replaceWith(err);
  };

  img.onclick = () => {
    openLightbox(src, img.alt);
  };

  return img;
}

function openLightbox(src, altText) {
  const prevFocus = typeof document !== 'undefined' ? document.activeElement : null;

  const overlay = el('div', 'pmed-lightbox');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('tabindex', '-1');

  const bigImg = el('img', 'pmed-lightbox-img');
  bigImg.src = src;
  bigImg.alt = altText || '';

  const closeBtn = btn('×', () => close(), 'pmed-lightbox-close');
  closeBtn.setAttribute('aria-label', 'Close');

  overlay.append(bigImg, closeBtn);

  function close() {
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', onKeyDown);
    }
    overlay.remove();
    if (prevFocus && typeof prevFocus.focus === 'function') {
      try { prevFocus.focus(); } catch {}
    }
  }

  function onKeyDown(e) {
    if (e && (e.key === 'Escape' || e.code === 'Escape')) {
      if (e.stopPropagation) e.stopPropagation();
      close();
    }
  }

  overlay.onclick = () => close();

  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', onKeyDown);
    if (document.body) {
      document.body.append(overlay);
    }
  }

  if (typeof overlay.focus === 'function') {
    try { overlay.focus(); } catch {}
  }
}

export function lazyMedia(getSrc, opts = {}) {
  const wrapper = el('span', 'pmed-lazy');
  const loading = el('span', 'pmed-loading pmed-muted', 'Loading picture...');
  wrapper.append(loading);

  if (typeof getSrc === 'function') {
    Promise.resolve()
      .then(() => getSrc())
      .then(src => {
        const view = mediaView(src, opts);
        if (wrapper.parentNode) {
          wrapper.replaceWith(view);
        } else {
          wrapper.textContent = '';
          wrapper.append(view);
        }
      })
      .catch(() => {
        const err = el('span', 'pmed-error pmed-muted', 'Could not load this file.');
        if (wrapper.parentNode) {
          wrapper.replaceWith(err);
        } else {
          wrapper.textContent = '';
          wrapper.append(err);
        }
      });
  } else {
    const err = el('span', 'pmed-error pmed-muted', 'Could not load this file.');
    wrapper.textContent = '';
    wrapper.append(err);
  }

  return wrapper;
}

export function mediaStyles() {
  return `
.pmed-picker { display: inline-flex; flex-direction: column; gap: 8px; max-width: 100%; font-family: inherit; }
.pmed-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 16px; min-height: 40px; font-size: 14px; font-weight: 500; border: 1px solid var(--line, #dce2ec); border-radius: 999px; background: var(--card, #ffffff); color: var(--fg, #10131a); cursor: pointer; transition: background .15s, border-color .15s; }
.pmed-btn:hover { background: var(--card2, #eef2f7); border-color: var(--mut, #6f7785); }
.pmed-dragover { border: 2px dashed var(--acc, #5b5ce2) !important; background: var(--card2, #eef2f7) !important; }
.pmed-preview { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border: 1px solid var(--line, #dce2ec); border-radius: var(--r, 16px); background: var(--card, #ffffff); max-width: 100%; flex-wrap: wrap; }
.pmed-thumb-img, .pmed-thumb-video { width: 48px; height: 48px; object-fit: cover; border-radius: 8px; flex-shrink: 0; background: var(--card2, #eef2f7); }
.pmed-info { display: flex; flex-direction: column; min-width: 0; flex: 1; overflow: hidden; }
.pmed-filename { font-size: 13.5px; font-weight: 500; color: var(--fg, #10131a); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pmed-filesize { font-size: 12px; color: var(--mut, #6f7785); }
.pmed-remove-btn { min-height: 40px; padding: 6px 14px; font-size: 13px; color: var(--err, #cf3f55); border: 1px solid color-mix(in srgb, var(--err, #cf3f55) 35%, transparent); border-radius: 999px; background: transparent; cursor: pointer; }
.pmed-remove-btn:hover { background: color-mix(in srgb, var(--err, #cf3f55) 10%, transparent); }
.pmed-img { max-width: 100%; max-height: 60vh; object-fit: contain; border-radius: var(--r, 12px); cursor: pointer; display: block; }
.pmed-video { max-width: 100%; max-height: 60vh; border-radius: var(--r, 12px); display: block; }
.pmed-muted { color: var(--mut, #6f7785); font-size: 13.5px; }
.pmed-error { color: var(--err, #cf3f55); font-size: 13.5px; }
.pmed-lazy { display: inline-block; max-width: 100%; }
.pmed-lightbox { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.85); display: flex; align-items: center; justify-content: center; z-index: 99999; cursor: pointer; padding: 20px; box-sizing: border-box; }
.pmed-lightbox-img { max-width: 90vw; max-height: 90vh; object-fit: contain; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
.pmed-lightbox-close { position: absolute; top: 16px; right: 20px; min-height: 40px; min-width: 40px; width: 40px; height: 40px; border-radius: 50%; border: 0; background: rgba(255, 255, 255, 0.2); color: #ffffff; font-size: 24px; cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1; }
.pmed-lightbox-close:hover { background: rgba(255, 255, 255, 0.4); }
`.trim();
}

export function installMediaStyles() {
  if (typeof document !== 'undefined' && !document.getElementById('pmed-css')) {
    const st = document.createElement('style');
    st.id = 'pmed-css';
    st.textContent = mediaStyles();
    if (document.head) {
      document.head.append(st);
    }
  }
}
