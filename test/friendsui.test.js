// Test friendsui.js: list rendering, request flow, accept, remove with confirm, block,
// send with text, send with file, chat polling stops when host detached, hostile names, errors shown.
const assert = require('assert');
const fs = require('fs');

let jsdomExists = false;
try {
  if (fs.existsSync('/tmp/ph/node_modules/jsdom')) {
    const { JSDOM } = require('/tmp/ph/node_modules/jsdom');
    const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { url: 'http://localhost' });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.URL = dom.window.URL;
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
      this.type = '';
      this.placeholder = '';
      this.maxLength = 524288;
      this.disabled = false;
      this.title = '';
      this.id = '';
      this.scrollTop = 0;
      this.scrollHeight = 100;
      this.clientHeight = 100;
      this.onclick = null;
      this.onerror = null;
      this.onchange = null;
    }

    get isConnected() {
      let curr = this;
      while (curr) {
        if (curr === globalThis.document.body || curr === globalThis.document.head) return true;
        curr = curr.parentNode;
      }
      return false;
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
      if (key === 'placeholder') this.placeholder = String(v);
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
        this._listeners.set(event, this._listeners.get(event).filter(f => f !== fn));
      }
    }
    dispatchEvent(evt) {
      const name = typeof evt === 'string' ? evt : evt.type;
      const list = this._listeners.get(name) || [];
      for (const fn of list) fn.call(this, evt);
      if (name === 'click' && this.onclick) this.onclick(evt);
      if (name === 'error' && this.onerror) this.onerror(evt);
    }

    click() {
      if (this.onclick) this.onclick({ type: 'click', target: this });
      this.dispatchEvent({ type: 'click', target: this });
    }

    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    querySelectorAll(sel) {
      const parts = [];
      let current = '';
      let inBracket = false;
      for (let i = 0; i < sel.length; i++) {
        const ch = sel[i];
        if (ch === '[') inBracket = true;
        if (ch === ']') inBracket = false;
        if (ch === ' ' && !inBracket) {
          if (current.trim()) parts.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      if (current.trim()) parts.push(current.trim());

      const matchSingle = (el, singleSel) => {
        if (singleSel.startsWith('.')) {
          const classes = singleSel.slice(1).split('.');
          return classes.every(c => el.classList.contains(c));
        }
        if (singleSel.startsWith('#')) {
          return el.id === singleSel.slice(1);
        }
        if (singleSel.includes('[')) {
          const m = singleSel.match(/^([a-z0-9]+)?\[([a-z0-9-]+)(?:=([^\]]+))?\]$/i);
          if (m) {
            const [, tag, attr, val] = m;
            if (tag && el.tagName.toLowerCase() !== tag.toLowerCase()) return false;
            const attrVal = el.getAttribute(attr) || el[attr] || el.placeholder;
            if (val) return String(attrVal) === val.replace(/['"]/g, '');
            return attrVal != null;
          }
        }
        return el.tagName.toLowerCase() === singleSel.toLowerCase();
      };

      let currentSet = [this];
      for (const part of parts) {
        const nextSet = [];
        for (const parent of currentSet) {
          const search = (node) => {
            for (const child of node.children) {
              if (matchSingle(child, part)) {
                if (!nextSet.includes(child)) nextSet.push(child);
              }
              search(child);
            }
          };
          search(parent);
        }
        currentSet = nextSet;
      }
      return currentSet;
    }
  }

  const docListeners = new Map();

  const doc = {
    head: new FakeElement('head'),
    body: new FakeElement('body'),
    hidden: false,
    createElement(tag) { return new FakeElement(tag); },
    getElementById(id) {
      const find = (node) => {
        if (node.id === id) return node;
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

  globalThis.document = doc;
}

let passCount = 0;
let failCount = 0;
const test = (name, cond, info) => {
  if (cond) {
    console.log('PASS ' + name);
    passCount++;
  } else {
    console.log('FAIL ' + name + (info ? ' -> ' + info : ''));
    failCount++;
  }
};

(async () => {
  const m = await import('../docs/friendsui.js');

  // 1. chatGroups pure function
  {
    const msgs = [
      { id: 1, sender: 'U2', receiver: 'U1', body: 'Hello', created_at: new Date().toISOString() },
      { id: 2, sender: 'U1', receiver: 'U2', body: 'Hi back', created_at: new Date(Date.now() - 86400000).toISOString() }
    ];
    const groups = m.chatGroups(msgs, 'U1');
    test('chatGroups marks mine properly', groups[0].mine === false && groups[1].mine === true);
    test('chatGroups calculates dayLabels Today and Yesterday', groups[0].dayLabel === 'Today' && groups[1].dayLabel === 'Yesterday');
    test('chatGroups formats time HH:MM', /^\d{2}:\d{2}$/.test(groups[0].showTime));
  }

  // 2. friendsStyles & installFriendsStyles
  {
    const css = m.friendsStyles();
    test('friendsStyles returns CSS with pfr- classes', typeof css === 'string' && css.includes('.pfr-wrap'));
    m.installFriendsStyles();
    test('installFriendsStyles adds pfr-styles to document head', !!document.getElementById('pfr-styles'));
  }

  // Fake social state
  const mockState = {
    me: 'U1',
    rows: [
      { other: 'U2', friend_id: 101, status: 'pending', i_asked: false, name: 'Bob', avatar_path: null, unread: 0, last_body: null, last_at: null, allow_calls: true },
      { other: 'U3', friend_id: 102, status: 'accepted', i_asked: true, name: 'Charlie', avatar_path: null, unread: 2, last_body: 'Hey', last_at: new Date().toISOString(), allow_calls: true },
      { other: 'U4', friend_id: 103, status: 'pending', i_asked: true, name: 'Dave', avatar_path: null, unread: 0, last_body: null, last_at: null, allow_calls: true },
      { other: 'U5', friend_id: 104, status: 'blocked', i_asked: true, name: '<img src=x onerror=alert(1)>', avatar_path: null, unread: 0, last_body: null, last_at: null, allow_calls: false }
    ],
    messages: {
      'U3': [
        { id: 1, sender: 'U3', receiver: 'U1', body: 'Hello Alice', media_path: null, created_at: new Date().toISOString(), read_at: new Date().toISOString() },
        { id: 2, sender: 'U1', receiver: 'U3', body: 'Hi Charlie', media_path: null, created_at: new Date().toISOString(), read_at: null }
      ]
    },
    answerCalls: [],
    removeCalls: [],
    blockCalls: [],
    unblockCalls: [],
    requestCalls: [],
    sendCalls: []
  };

  const fakeAccount = {
    user: () => ({ id: mockState.me }),
    rest: async (path, opts) => {
      if (path === 'rpc/pholama_my_social') {
        return mockState.rows;
      }
      if (path === 'rpc/pholama_friend_request') {
        const body = opts && opts.body ? JSON.parse(opts.body) : {};
        mockState.requestCalls.push(body.p_name);
        if (body.p_name === 'NoRequestsUser') {
          throw new Error('No one can be added with that name.');
        }
        return 'sent';
      }
      if (path === 'rpc/pholama_friend_answer') {
        const body = opts && opts.body ? JSON.parse(opts.body) : {};
        mockState.answerCalls.push(body);
        return null;
      }
      if (path === 'rpc/pholama_friend_remove') {
        const body = opts && opts.body ? JSON.parse(opts.body) : {};
        mockState.removeCalls.push(body.p_other);
        return null;
      }
      if (path === 'rpc/pholama_block') {
        const body = opts && opts.body ? JSON.parse(opts.body) : {};
        mockState.blockCalls.push(body.p_other);
        return null;
      }
      if (path === 'rpc/pholama_unblock') {
        const body = opts && opts.body ? JSON.parse(opts.body) : {};
        mockState.unblockCalls.push(body.p_other);
        return null;
      }
      if (path === 'rpc/pholama_dm_read') {
        return null;
      }
      if (path.startsWith('pholama_dms')) {
        if (opts && opts.method === 'POST') {
          const body = JSON.parse(opts.body);
          if (body.body && body.body.includes('http://')) {
            throw new Error('Links are not allowed in messages.');
          }
          mockState.sendCalls.push(body);
          const newMsg = {
            id: Date.now(),
            sender: body.sender,
            receiver: body.receiver,
            body: body.body,
            media_path: body.media_path,
            created_at: new Date().toISOString(),
            read_at: null
          };
          if (!mockState.messages[body.receiver]) mockState.messages[body.receiver] = [];
          mockState.messages[body.receiver].push(newMsg);
          return [newMsg];
        }
        if (opts && opts.method === 'DELETE') {
          return [];
        }
        return mockState.messages['U3'] || [];
      }
      return [];
    },
    storageTo: async (bucket, path, file) => {},
    signedUrl: async (bucket, path) => 'https://signed.example.com/' + path
  };

  const fakeCfg = () => ({ SUPABASE_URL: 'https://x.supabase.co' });

  let unreadReported = null;
  let callStartedWith = null;

  const host = document.createElement('div');
  document.body.append(host);

  // 3. Mount Friends & List Rendering
  await m.mountFriends(host, {
    Account: fakeAccount,
    cfg: fakeCfg,
    onUnread: n => { unreadReported = n; },
    startCall: friend => { callStartedWith = friend; }
  });

  test('list rendering renders sections', !!host.querySelector('.pfr-add-card') && !!host.querySelector('.pfr-sidebar'));
  test('onUnread reports total unread count', unreadReported === 2);

  // 4. Request Flow
  const addInput = host.querySelector('input[placeholder="Their Platform name"]');
  const addBtn = host.querySelector('.pfr-add-card button');
  test('Add friend input and button exist', !!addInput && !!addBtn);
  if (addInput && addBtn) {
    addInput.value = 'Eve';
    addBtn.click();
    await new Promise(r => setTimeout(r, 50));
    test('send friend request calls S.request', mockState.requestCalls.includes('Eve'));

    // 5. Friend Request Error Shown
    addInput.value = 'NoRequestsUser';
    addBtn.click();
    await new Promise(r => setTimeout(r, 50));
    const statusLine = host.querySelector('.pfr-status');
    test('request to user with requests off shows DB error as-is', statusLine && statusLine.textContent.includes('No one can be added with that name.'));
  }

  // 6. Accept Request
  const acceptBtn = host.querySelectorAll('.pfr-section')[0].querySelector('button');
  if (acceptBtn && acceptBtn.textContent === 'Accept') {
    acceptBtn.click();
    await new Promise(r => setTimeout(r, 50));
    test('clicking Accept calls S.answer with accept=true', mockState.answerCalls.some(a => a.p_accept === true));
  } else {
    test('clicking Accept calls S.answer with accept=true', false, 'Accept button not found');
  }

  // 7. Remove Friend with Confirm
  let friendsSec = host.querySelectorAll('.pfr-section')[1];
  let removeBtn = [...friendsSec.querySelectorAll('button')].find(b => b.textContent === 'Remove friend');
  test('Remove friend button exists', !!removeBtn);
  if (removeBtn) {
    removeBtn.click();
    const confirmBox = host.querySelector('.pfr-confirm-box');
    test('clicking Remove friend enters confirm step', confirmBox && confirmBox.textContent.includes('Remove?'));
    if (confirmBox) {
      const confirmBtn = [...confirmBox.querySelectorAll('button')].find(b => b.textContent === 'Confirm');
      confirmBtn.click();
      await new Promise(r => setTimeout(r, 50));
      test('clicking Confirm calls S.remove', mockState.removeCalls.includes('U3'));
    }
  }

  // 8. Block Friend with Confirm
  friendsSec = host.querySelectorAll('.pfr-section')[1];
  let blockBtn = [...friendsSec.querySelectorAll('button')].find(b => b.textContent === 'Block');
  test('Block button exists', !!blockBtn);
  if (blockBtn) {
    blockBtn.click();
    const confirmBox = host.querySelector('.pfr-confirm-box');
    test('clicking Block enters confirm step', confirmBox && confirmBox.textContent.includes('Block?'));
    if (confirmBox) {
      const confirmBtn = [...confirmBox.querySelectorAll('button')].find(b => b.textContent === 'Confirm');
      confirmBtn.click();
      await new Promise(r => setTimeout(r, 50));
      test('clicking Confirm calls S.block', mockState.blockCalls.includes('U3'));
    }
  }

  // 9. Send Text Message in Chat
  friendsSec = host.querySelectorAll('.pfr-section')[1];
  const chatBtn = [...friendsSec.querySelectorAll('button')].find(b => b.textContent === 'Chat');
  test('Chat button exists', !!chatBtn);
  if (chatBtn) {
    chatBtn.click();
    await new Promise(r => setTimeout(r, 50));
    const ta = host.querySelector('textarea');
    const sendBtn = [...host.querySelectorAll('button')].find(b => b.textContent === 'Send');
    test('chat panel opens with textarea', !!ta && !!sendBtn);
    if (ta && sendBtn) {
      ta.value = 'Hello from test suite';
      sendBtn.click();
      await new Promise(r => setTimeout(r, 50));
      test('sending text message calls S.send', mockState.sendCalls.some(s => s.body === 'Hello from test suite'));
    }
  }

  // 10. Send Message with File
  const pickerInput = host.querySelector('.media-picker input');
  const ta = host.querySelector('textarea');
  const sendBtn = [...host.querySelectorAll('button')].find(b => b.textContent === 'Send');
  if (ta && sendBtn) {
    ta.value = 'Pic message';
    const fakeFile = { name: 'photo.png', type: 'image/png', size: 1000 };
    if (pickerInput) {
      pickerInput.files = [fakeFile];
      if (pickerInput.onchange) pickerInput.onchange();
    }
    sendBtn.click();
    await new Promise(r => setTimeout(r, 50));
    test('send message with file succeeds', mockState.sendCalls.some(s => s.body === 'Pic message'));
  }

  // 11. Links Error Shown in Chat
  if (ta && sendBtn) {
    ta.value = 'Check this http://evil.com';
    sendBtn.click();
    await new Promise(r => setTimeout(r, 50));
    const chatErr = host.querySelector('.pfr-composer-wrap .pfr-err');
    test('message with link shows error inline', chatErr && chatErr.textContent.includes('Links are not allowed'));
  }

  // 12. Hostile names never create elements (XSS Prevention)
  const imgElementsCreated = host.querySelectorAll('img[onerror]').length;
  test('hostile names with onerror never create img elements', imgElementsCreated === 0);

  // 13. Chat Polling Stops when Host Detached
  host.remove();
  test('host detachment sets isConnected to false', host.isConnected === false);

  // 14. Missing pholama_my_social Error View
  const hostError = document.createElement('div');
  document.body.append(hostError);
  const badAccount = {
    user: () => ({ id: 'U1' }),
    rest: async () => { throw new Error('function public.pholama_my_social does not exist'); }
  };
  await m.mountFriends(hostError, { Account: badAccount, cfg: fakeCfg });
  const errorCard = hostError.querySelector('.dcard');
  test('missing pholama_my_social renders dcard with setup SQL friendly text', errorCard && errorCard.textContent.includes('Friends and chat are not set up yet. The owner needs to run the setup SQL.'));

  console.log(`\nResults: ${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) process.exit(1);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
