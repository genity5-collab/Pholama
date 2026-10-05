// Test mediaui.js: valid file accepted, svg and 30MB video rejected, remove clears, mediaView security, lightbox, lazyMedia, CSS.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let jsdomExists = false;
try {
  if (fs.existsSync('/tmp/ph/node_modules/jsdom')) {
    const { JSDOM } = require('/tmp/ph/node_modules/jsdom');
    const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { url: 'http://localhost' });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.URL = dom.window.URL;
    if (!globalThis.URL.createObjectURL) {
      globalThis.URL.createObjectURL = () => 'blob:http://localhost/fake-' + Math.random().toString(36).slice(2);
      globalThis.URL.revokeObjectURL = () => {};
    }
    jsdomExists = true;
  }
} catch (e) {}

if (!jsdomExists) {
  setupFakeDOM();
}

function setupFakeDOM() {
  class FakeClassList {
    constructor(el) { this._el = el; }
    get _classes() { return (this._el.className || '').split(/\s+/).filter(Boolean); }
    set _classes(arr) { this._el.className = arr.join(' '); }
    add(...cls) {
      const set = new Set(this._classes);
      cls.forEach(c => set.add(c));
      this._classes = Array.from(set);
    }
    remove(...cls) {
      const set = new Set(this._classes);
      cls.forEach(c => set.delete(c));
      this._classes = Array.from(set);
    }
    toggle(cls, force) {
      const set = new Set(this._classes);
      if (force === undefined) {
        if (set.has(cls)) set.delete(cls); else set.add(cls);
      } else if (force) set.add(cls); else set.delete(cls);
      this._classes = Array.from(set);
    }
    contains(cls) { return this._classes.includes(cls); }
  }

  class FakeElement {
    constructor(tagName) {
      this.tagName = String(tagName).toUpperCase();
      this.nodeType = 1;
      this.className = '';
      this.classList = new FakeClassList(this);
      this.children = [];
      this.childNodes = this.children;
      this.parentNode = null;
      this.attributes = new Map();
      this.style = {};
      this._listeners = new Map();
      this._textContent = '';
      this.value = '';
      this.files = [];
      this.type = '';
      this.accept = '';
      this.src = '';
      this.alt = '';
      this.id = '';
      this.muted = false;
      this.controls = false;
      this.preload = '';
      this.playsInline = false;
      this.loading = '';
      this.decoding = '';
      this.referrerPolicy = '';
      this.onclick = null;
      this.onerror = null;
      this.onchange = null;
    }

    get textContent() {
      if (this.children.length === 0) return this._textContent;
      return this.children.map(c => c.textContent).join('');
    }
    set textContent(val) {
      this.children.forEach(c => c.parentNode = null);
      this.children = [];
      this.childNodes = this.children;
      this._textContent = String(val == null ? '' : val);
    }

    get innerHTML() {
      let res = '';
      if (this._textContent && this.children.length === 0) res += this._textContent;
      for (const child of this.children) {
        let tag = child.tagName.toLowerCase();
        let attrs = '';
        if (child.className) attrs += ` class="${child.className}"`;
        if (child.src) attrs += ` src="${child.src}"`;
        if (child.alt) attrs += ` alt="${child.alt}"`;
        if (child.getAttribute('onerror')) attrs += ` onerror="${child.getAttribute('onerror')}"`;
        res += `<${tag}${attrs}>${child.innerHTML}</${tag}>`;
      }
      return res;
    }

    setAttribute(k, v) {
      const key = String(k).toLowerCase();
      this.attributes.set(key, String(v));
      if (key === 'id') this.id = String(v);
      if (key === 'type') this.type = String(v);
      if (key === 'accept') this.accept = String(v);
    }
    getAttribute(k) { return this.attributes.get(String(k).toLowerCase()) || null; }
    removeAttribute(k) { this.attributes.delete(String(k).toLowerCase()); }

    append(...nodes) {
      for (const n of nodes) {
        const child = typeof n === 'string' ? new FakeElement('#text') : n;
        if (typeof n === 'string') child._textContent = n;
        child.parentNode = this;
        this.children.push(child);
      }
    }
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) {
        this.children.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    }
    replaceChild(newChild, oldChild) {
      const idx = this.children.indexOf(oldChild);
      if (idx >= 0) {
        oldChild.parentNode = null;
        newChild.parentNode = this;
        this.children[idx] = newChild;
      }
      return oldChild;
    }
    replaceWith(newChild) {
      if (this.parentNode) {
        this.parentNode.replaceChild(newChild, this);
      }
    }
    remove() {
      if (this.parentNode) {
        this.parentNode.removeChild(this);
      }
    }

    addEventListener(event, fn) {
      if (!this._listeners.has(event)) this._listeners.set(event, []);
      this._listeners.get(event).push(fn);
    }
    removeEventListener(event, fn) {
      if (this._listeners.has(event)) {
        const arr = this._listeners.get(event).filter(f => f !== fn);
        this._listeners.set(event, arr);
      }
    }
    dispatchEvent(evt) {
      const eventName = typeof evt === 'string' ? evt : evt.type;
      const list = this._listeners.get(eventName) || [];
      for (const fn of list) fn.call(this, evt);
      if (eventName === 'click' && this.onclick) this.onclick(evt);
      if (eventName === 'error' && this.onerror) this.onerror(evt);
      if (eventName === 'change' && this.onchange) this.onchange(evt);
    }

    click() {
      if (this.onclick) this.onclick({ type: 'click', target: this, stopPropagation: () => {} });
      this.dispatchEvent({ type: 'click', target: this, stopPropagation: () => {} });
    }
    focus() {
      if (globalThis.document) globalThis.document.activeElement = this;
    }

    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    }
    querySelectorAll(sel) {
      const res = [];
      const match = (el) => {
        if (sel.startsWith('.')) {
          if (el.classList.contains(sel.slice(1))) return true;
        } else if (sel.startsWith('#')) {
          if (el.id === sel.slice(1) || el.getAttribute('id') === sel.slice(1)) return true;
        } else if (sel.includes('[')) {
          const m = sel.match(/^([a-z0-9]+)?\[([a-z0-9-]+)(?:=([^\]]+))?\]$/i);
          if (m) {
            const [, tag, attr, val] = m;
            if (tag && el.tagName.toLowerCase() !== tag.toLowerCase()) return false;
            const attrVal = el.getAttribute(attr) || el[attr];
            if (val) return String(attrVal) === val.replace(/['"]/g, '');
            return attrVal != null;
          }
        } else {
          if (el.tagName.toLowerCase() === sel.toLowerCase()) return true;
        }
        return false;
      };

      const search = (node) => {
        for (const child of node.children) {
          if (match(child)) res.push(child);
          search(child);
        }
      };
      search(this);
      return res;
    }
  }

  const docListeners = new Map();

  const doc = {
    head: new FakeElement('head'),
    body: new FakeElement('body'),
    activeElement: null,
    createElement(tag) { return new FakeElement(tag); },
    getElementById(id) {
      const find = (node) => {
        if (node.id === id || node.getAttribute('id') === id) return node;
        for (const c of node.children) {
          const r = find(c);
          if (r) return r;
        }
        return null;
      };
      return find(doc.head) || find(doc.body);
    },
    addEventListener(event, fn) {
      if (!docListeners.has(event)) docListeners.set(event, []);
      docListeners.get(event).push(fn);
    },
    removeEventListener(event, fn) {
      if (docListeners.has(event)) {
        docListeners.set(event, docListeners.get(event).filter(f => f !== fn));
      }
    },
    dispatchEvent(evt) {
      const name = typeof evt === 'string' ? evt : evt.type;
      const list = docListeners.get(name) || [];
      for (const fn of list) fn(evt);
    },
    querySelector(sel) { return doc.body.querySelector(sel) || doc.head.querySelector(sel); },
    querySelectorAll(sel) { return [...doc.body.querySelectorAll(sel), ...doc.head.querySelectorAll(sel)]; }
  };

  const createdUrls = new Set();
  const revokedUrls = new Set();

  const URL = {
    createObjectURL(file) {
      const u = 'blob:http://localhost/' + Math.random().toString(36).slice(2);
      createdUrls.add(u);
      return u;
    },
    revokeObjectURL(url) {
      revokedUrls.add(url);
    }
  };

  globalThis.document = doc;
  globalThis.URL = URL;
  globalThis.FakeDOMState = { createdUrls, revokedUrls };
}

let bad = 0;
const ok = (name, cond, info) => {
  if (cond) {
    console.log('PASS ' + name);
  } else {
    console.log('FAIL ' + name + (info ? '  -> ' + info : ''));
    bad++;
  }
};

(async () => {
  const m = await import('../docs/mediaui.js');

  // 1. attachPicker - valid file accepted
  {
    let selected = null;
    let err = null;
    const picker = m.attachPicker({
      accept: 'both',
      onChange: f => { selected = f; },
      onError: msg => { err = msg; }
    });

    const file = { name: 'vacation.jpg', type: 'image/jpeg', size: 150000 };
    const input = picker.node.querySelector('input[type="file"]');
    input.files = [file];
    input.onchange();

    ok('attachPicker accepts valid image file', picker.get() === file && selected === file && err === null);
    ok('attachPicker shows filename in preview', picker.node.querySelector('.pmed-filename')?.textContent === 'vacation.jpg');
    ok('attachPicker shows size in preview', /KB/.test(picker.node.querySelector('.pmed-filesize')?.textContent || ''));
  }

  // 1b. attachPicker - accept="image" mode accepts image and refuses video
  {
    let err = null;
    const picker = m.attachPicker({
      accept: 'image',
      onError: msg => { err = msg; }
    });

    const input = picker.node.querySelector('input[type="file"]');
    ok('attachPicker accept attribute lists image types only', input.accept === 'image/png,image/jpeg,image/webp,image/gif');

    const vidFile = { name: 'clip.mp4', type: 'video/mp4', size: 2000000 };
    input.files = [vidFile];
    input.onchange();

    ok('attachPicker accept="image" rejects video file', picker.get() === null && typeof err === 'string' && err.length > 0);
  }

  // 2. SVG and 30MB video rejected with onError
  {
    let err = null;
    const picker = m.attachPicker({
      onError: msg => { err = msg; }
    });

    const input = picker.node.querySelector('input[type="file"]');

    // SVG
    err = null;
    const svgFile = { name: 'icon.svg', type: 'image/svg+xml', size: 1000 };
    input.files = [svgFile];
    input.onchange();
    ok('svg rejected with onError', picker.get() === null && typeof err === 'string' && /picture/i.test(err));

    // 30MB video
    err = null;
    const bigVid = { name: 'heavy.mp4', type: 'video/mp4', size: 30 * 1024 * 1024 };
    input.files = [bigVid];
    input.onchange();
    ok('30MB video rejected with onError', picker.get() === null && typeof err === 'string' && /25 MB|shorter/i.test(err));
  }

  // 3. Remove clears
  {
    let selected = 'initial';
    const picker = m.attachPicker({
      onChange: f => { selected = f; }
    });

    const file = { name: 'pic.png', type: 'image/png', size: 50000 };
    const input = picker.node.querySelector('input[type="file"]');
    input.files = [file];
    input.onchange();

    ok('picker holds file before clear', picker.get() === file);

    picker.clear();
    ok('remove / clear resets picker get()', picker.get() === null);
    ok('remove / clear calls onChange(null)', selected === null);
    ok('picker node returns to add button state', !!picker.node.querySelector('.pmed-btn'));
  }

  // 4. mediaView refuses javascript:, http:// and data: sources
  {
    const jsNode = m.mediaView('javascript:alert(1)');
    ok('mediaView refuses javascript:', jsNode.tagName === 'SPAN' && jsNode.children.length === 0);

    const httpNode = m.mediaView('http://example.com/cat.jpg');
    ok('mediaView refuses http:', httpNode.tagName === 'SPAN' && httpNode.children.length === 0);

    const dataNode = m.mediaView('data:image/png;base64,iVBORw0KGgo');
    ok('mediaView refuses data:', dataNode.tagName === 'SPAN' && dataNode.children.length === 0);

    const httpsNode = m.mediaView('https://example.com/cat.jpg');
    ok('mediaView accepts https:', httpsNode.tagName === 'IMG' && httpsNode.src === 'https://example.com/cat.jpg');

    const blobNode = m.mediaView('blob:http://localhost/abc-123');
    ok('mediaView accepts blob:', blobNode.tagName === 'IMG' && blobNode.src === 'blob:http://localhost/abc-123');
  }

  // 4b. mediaView video rendering and error handling
  {
    const vidNode = m.mediaView('https://example.com/video.mp4', { video: true });
    ok('mediaView creates video element when video option is true', vidNode.tagName === 'VIDEO' && vidNode.src === 'https://example.com/video.mp4');
    ok('mediaView video has controls and playsinline', vidNode.controls === true && (vidNode.playsInline === true || vidNode.getAttribute('playsinline') !== null));

    // Error handling test on image and video
    const imgNode = m.mediaView('https://example.com/broken.png');
    document.body.append(imgNode);
    imgNode.onerror();
    const errSpan = document.body.querySelector('.pmed-error');
    ok('mediaView img onerror replaces element with error message', errSpan && errSpan.textContent === 'Could not load this file.');
    errSpan.remove();
  }

  // 5. Lightbox opens and closes
  {
    const img = m.mediaView('https://example.com/photo.jpg', { alt: 'A nice photo' });
    document.body.append(img);

    img.click();
    const lightbox = document.body.querySelector('.pmed-lightbox');
    ok('lightbox opens on click with role=dialog and aria-modal', lightbox && lightbox.getAttribute('role') === 'dialog' && lightbox.getAttribute('aria-modal') === 'true');
    ok('lightbox contains full-size img', lightbox && lightbox.querySelector('img')?.src === 'https://example.com/photo.jpg');

    // Close on Escape key
    document.dispatchEvent({ type: 'keydown', key: 'Escape' });
    const closedLightbox = document.body.querySelector('.pmed-lightbox');
    ok('lightbox closes on Escape key press', closedLightbox === null);

    img.remove();
  }

  // 6. Security rule: text is never injected as HTML
  {
    const hostileName = '<img src=x onerror=alert(1)>.png';
    const hostileFile = { name: hostileName, type: 'image/png', size: 50000 };

    const picker = m.attachPicker();
    const input = picker.node.querySelector('input[type="file"]');
    input.files = [hostileFile];
    input.onchange();

    const filenameSpan = picker.node.querySelector('.pmed-filename');
    ok('hostile filename stored safely in textContent', filenameSpan && filenameSpan.textContent === hostileName);

    // Check innerHTML or DOM children: no img element with onerror attribute exists inside filename span
    const badImgs = filenameSpan ? filenameSpan.querySelectorAll('img[onerror]') : [];
    ok('no HTML elements injected via hostile filename in preview name', badImgs.length === 0);
  }

  // 7. lazyMedia
  {
    const lazyNode = m.lazyMedia(async () => 'https://example.com/private-photo.jpg', { alt: 'Private' });
    document.body.append(lazyNode);

    ok('lazyMedia starts with loading placeholder', lazyNode.textContent.includes('Loading picture...'));

    await new Promise(r => setTimeout(r, 50));

    const loadedImg = document.body.querySelector('.pmed-img');
    ok('lazyMedia swaps in mediaView once getSrc resolves', loadedImg && loadedImg.src === 'https://example.com/private-photo.jpg');
    if (loadedImg) loadedImg.remove();

    // Test failing getSrc
    const failingLazy = m.lazyMedia(async () => { throw new Error('Unauthorized'); });
    document.body.append(failingLazy);

    await new Promise(r => setTimeout(r, 50));
    const errText = document.body.querySelector('.pmed-error');
    ok('lazyMedia shows error message on getSrc failure', errText && errText.textContent === 'Could not load this file.');
    if (errText) errText.remove();
  }

  // 8. mediaStyles & installMediaStyles
  {
    const css = m.mediaStyles();
    ok('mediaStyles returns CSS string with pmed- rules', typeof css === 'string' && css.includes('.pmed-picker') && css.includes('.pmed-lightbox'));

    m.installMediaStyles();
    const styleEl = document.getElementById('pmed-css');
    ok('installMediaStyles appends style element with id pmed-css', styleEl !== null && styleEl.textContent.includes('.pmed-picker'));
  }

  console.log(bad ? bad + ' FAILED' : 'ALL PASSED');
  process.exit(bad ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
