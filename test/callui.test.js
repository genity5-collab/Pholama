const assert = require('assert');

// ---------- Fake DOM Environment for Node.js ----------
class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.nodeName = this.tagName;
    this.children = [];
    this.parentNode = null;
    this._attributes = new Map();
    this._classList = new Set();
    this._textContent = '';
    this.style = {};
    this.hidden = false;
    this.type = 'button';
    this.onclick = null;
    this.isConnected = true;
    this.listeners = new Map();
  }

  get className() { return Array.from(this._classList).join(' '); }
  set className(val) { this._classList = new Set((val || '').split(/\s+/).filter(Boolean)); }

  get classList() {
    return {
      add: (...cls) => cls.forEach(c => c && this._classList.add(c)),
      remove: (...cls) => cls.forEach(c => this._classList.delete(c)),
      toggle: (c, force) => {
        if (force === undefined) {
          if (this._classList.has(c)) this._classList.delete(c);
          else this._classList.add(c);
        } else if (force) this._classList.add(c);
        else this._classList.delete(c);
      },
      contains: c => this._classList.has(c)
    };
  }

  get textContent() {
    if (this.children.length === 0) return this._textContent;
    return this.children.map(c => typeof c === 'string' ? c : c.textContent).join('');
  }
  set textContent(val) {
    this.children = [];
    this._textContent = String(val || '');
  }

  get innerHTML() { return ''; }
  set innerHTML(val) { throw new Error('SECURITY RULE: innerHTML is forbidden'); }

  setAttribute(k, v) {
    this._attributes.set(k, String(v));
    if (k === 'hidden') this.hidden = String(v) !== 'false' && Boolean(v);
  }
  getAttribute(k) { return this._attributes.get(k) || null; }
  hasAttribute(k) { return this._attributes.has(k); }

  appendChild(child) {
    if (child instanceof FakeElement) {
      child.parentNode = this;
      this.children.push(child);
    }
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
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }

  querySelectorAll(sel) {
    const results = [];
    const check = (node) => {
      if (!node) return;
      if (sel.startsWith('.')) {
        if (node.classList && node.classList.contains(sel.slice(1))) results.push(node);
      } else if (sel.startsWith('#')) {
        if (node.id === sel.slice(1)) results.push(node);
      } else if (sel.includes('[role=')) {
        const roleMatch = sel.match(/\[role=["']?([^"']+)["']?\]/);
        if (roleMatch && node.getAttribute && node.getAttribute('role') === roleMatch[1]) results.push(node);
      } else if (node.tagName && node.tagName.toLowerCase() === sel.toLowerCase()) {
        results.push(node);
      }
      if (node.children) {
        for (const c of node.children) {
          if (c instanceof FakeElement) check(c);
        }
      }
    };
    check(this);
    return results;
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  dispatchEvent(event) {
    if (typeof this.onclick === 'function') this.onclick(event);
    const fns = this.listeners.get(event.type) || [];
    for (const fn of fns) fn(event);
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this });
  }
}

const body = new FakeElement('body');
const head = new FakeElement('head');

global.document = {
  hidden: false,
  body,
  head,
  documentElement: body,
  createElement: (tag) => new FakeElement(tag),
  getElementById: (id) => body.querySelector('#' + id) || head.querySelector('#' + id),
  querySelector: (sel) => body.querySelector(sel),
  querySelectorAll: (sel) => body.querySelectorAll(sel),
  addEventListener: () => {},
  removeEventListener: () => {}
};

let audioCtxCount = 0;
class FakeAudioContext {
  constructor() {
    audioCtxCount++;
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
  }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  createOscillator() {
    return {
      type: 'sine',
      frequency: { setValueAtTime() {} },
      connect() {},
      start() {},
      stop() {}
    };
  }
  createGain() {
    return {
      gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {}
    };
  }
}

global.AudioContext = FakeAudioContext;
global.window = {
  addEventListener: (type, fn) => {
    if (type === 'click' || type === 'keydown') fn();
  },
  removeEventListener: () => {}
};
global.navigator = { mediaDevices: {} };

// ---------- Fake WebRTC and MediaStream ----------
class FakeTrack {
  constructor(kind = 'audio') {
    this.kind = kind;
    this.enabled = true;
    this.stopped = false;
  }
  stop() { this.stopped = true; }
}

class FakeStream {
  constructor() {
    this.tracks = [new FakeTrack('audio')];
  }
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks; }
}

class FakeRTCPeerConnection {
  constructor(config) {
    this.config = config;
    this.localDescription = null;
    this.remoteDescription = null;
    this.signalingState = 'stable';
    this.iceCandidates = [];
    this.closed = false;
    this.onicecandidate = null;
    this.ontrack = null;
  }
  addTrack(track, stream) {}
  async createOffer() { return { type: 'offer', sdp: 'fake-sdp-offer' }; }
  async createAnswer() { return { type: 'answer', sdp: 'fake-sdp-answer' }; }
  async setLocalDescription(desc) { this.localDescription = desc; }
  async setRemoteDescription(desc) { this.remoteDescription = desc; }
  async addIceCandidate(cand) { this.iceCandidates.push(cand); }
  close() { this.closed = true; }
}

// ---------- Test Suite ----------
(async () => {
  const callui = await import('../docs/callui.js');
  let passed = 0;
  const test = (name, fn) => {
    return (async () => {
      try {
        await fn();
        passed++;
        console.log('PASS ' + name);
      } catch (err) {
        console.error('FAIL ' + name);
        console.error(err);
        process.exitCode = 1;
      }
    })();
  };

  // --- Test 1: bell count and dropdown ---
  await test('bell count and dropdown rendering & click actions', async () => {
    let openedChat = null;
    let openedFriends = false;
    let seenCalled = false;

    const mockSocial = {
      async notifications() {
        return [
          { id: 1, kind: 'message', from_user: 'user-a', info: 'Alice', seen: false, created_at: new Date().toISOString() },
          { id: 2, kind: 'friend_request', from_user: 'user-b', info: 'Bob', seen: false, created_at: new Date().toISOString() }
        ];
      },
      async prefs() { return { notify: true }; },
      async markNotificationsSeen() { seenCalled = true; },
      async clearNotifications() {}
    };

    const host = document.createElement('div');
    const ctx = {
      social: mockSocial,
      onOpenChat(uid) { openedChat = uid; },
      onOpenFriends() { openedFriends = true; }
    };

    const bell = callui.mountBell(host, ctx);
    await bell.refresh();

    const badge = host.querySelector('.pcl-badge');
    assert.strictEqual(badge.hidden, false, 'Badge should be visible');
    assert.strictEqual(badge.textContent, '2', 'Unread count should be 2');

    const bellBtn = host.querySelector('.pcl-bell-btn');
    bellBtn.click();
    await new Promise(r => setTimeout(r, 10));

    assert.strictEqual(seenCalled, true, 'markNotificationsSeen should be called on open');

    const dropdown = host.querySelector('.pcl-dropdown');
    assert.strictEqual(dropdown.hidden, false, 'Dropdown should be visible');

    const items = host.querySelectorAll('.pcl-note-item');
    assert.strictEqual(items.length, 2, 'Should display 2 notification items');

    // Click message item
    items[0].click();
    assert.strictEqual(openedChat, 'user-a', 'Clicking message item should open chat for user-a');

    // Click friend request item
    items[1].click();
    assert.strictEqual(openedFriends, true, 'Clicking friend request item should open friends');

    bell.stop();
  });

  // --- Test 2: ding only when count rises and notify is on ---
  await test('ding only plays when unread count rises and notify is enabled', async () => {
    let count = 1;
    let notifyPref = true;
    const initialAudioCount = audioCtxCount;

    const mockSocial = {
      async notifications() {
        const notes = [];
        for (let i = 0; i < count; i++) {
          notes.push({ id: i + 1, kind: 'message', from_user: 'u', seen: false });
        }
        return notes;
      },
      async prefs() { return { notify: notifyPref }; }
    };

    const host = document.createElement('div');
    const ctx = { social: mockSocial, userGestured: true };

    const bell = callui.mountBell(host, ctx);
    await bell.refresh(); // Initial load sets baseline (count = 1)

    const baselineAudioCount = audioCtxCount;

    // Count stays same (1) -> no ding
    await bell.refresh();
    assert.strictEqual(audioCtxCount, baselineAudioCount, 'No ding when count stays same');

    // Count rises to 3, notify = true -> ding plays
    count = 3;
    await bell.refresh();
    assert.ok(audioCtxCount > baselineAudioCount, 'Ding should play when count rises');

    const afterDingAudioCount = audioCtxCount;

    // Count rises to 5, but notify = false -> no ding
    notifyPref = false;
    count = 5;
    await bell.refresh();
    assert.strictEqual(audioCtxCount, afterDingAudioCount, 'No ding when notify pref is false');

    bell.stop();
  });

  // --- Test 3: settings toggle save and rollback on error ---
  await test('social settings toggle saves optimism and rolls back on error', async () => {
    let savedPrefs = null;
    let shouldFail = false;

    const mockSocial = {
      async prefs() { return { allow_requests: true, allow_dms: true, allow_calls: true, notify: true }; },
      async savePrefs(p) {
        if (shouldFail) throw new Error('Network failed');
        savedPrefs = p;
      }
    };

    const host = document.createElement('div');
    await callui.mountSocialSettings(host, { social: mockSocial });

    const switches = host.querySelectorAll('button[role="switch"]');
    assert.strictEqual(switches.length, 4, 'Should render 4 switches');

    // Successful toggle on 'Friend requests' (allow_requests)
    const reqSwitch = switches[0];
    assert.strictEqual(reqSwitch.getAttribute('aria-checked'), 'true');

    reqSwitch.click();
    await new Promise(r => setTimeout(r, 10));

    assert.strictEqual(reqSwitch.getAttribute('aria-checked'), 'false', 'Switch toggles to false');
    assert.strictEqual(savedPrefs.allow_requests, false, 'savePrefs called with false');

    // Failing toggle on 'Calls' (allow_calls)
    shouldFail = true;
    const callSwitch = switches[2];
    assert.strictEqual(callSwitch.getAttribute('aria-checked'), 'true');

    callSwitch.click();
    await new Promise(r => setTimeout(r, 10));

    assert.strictEqual(callSwitch.getAttribute('aria-checked'), 'true', 'Switch rolls back to true on error');
    const errEl = host.querySelector('.pcl-settings-err');
    assert.ok(errEl.textContent.includes('Network failed'), 'Error message displayed');
  });

  // --- Test 4: caller flow start->answer->connected->hangup ---
  await test('caller flow start -> answer -> connected -> hangup calls RPCs in order and closes tracks', async () => {
    const rpcLog = [];
    let callState = 'ringing';
    let localStream = new FakeStream();

    const mockSocial = {
      async callStart(other, offer) {
        rpcLog.push({ call: 'callStart', other, offer: JSON.parse(offer) });
        return 'call-101';
      },
      async callIce(id, ice) {
        rpcLog.push({ call: 'callIce', id, ice: JSON.parse(ice) });
      },
      async call(id) {
        return {
          id,
          status: callState,
          answer: callState === 'answered' ? JSON.stringify({ type: 'answer', sdp: 'ans-101' }) : null,
          ice_callee: callState === 'answered' ? [JSON.stringify({ candidate: 'callee-ice' })] : []
        };
      },
      async callEnd(id) {
        rpcLog.push({ call: 'callEnd', id });
      }
    };

    const env = {
      RTCPeerConnection: FakeRTCPeerConnection,
      getUserMedia: async () => localStream,
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (id) => clearInterval(id)
    };

    const calls = callui.createCalls({ social: mockSocial, getFriendName: () => 'Alice' }, env);

    // 1. Caller starts call
    await calls.start({ id: 'user-alice', name: 'Alice' });

    assert.strictEqual(rpcLog[0].call, 'callStart');
    assert.strictEqual(rpcLog[0].other, 'user-alice');

    const overlay = document.querySelector('.pcl-overlay');
    assert.ok(overlay, 'In-call overlay rendered');
    assert.ok(overlay.textContent.includes('Alice'), 'Overlay shows friend name');

    // 2. Answer arrives
    callState = 'answered';
    await new Promise(r => setTimeout(r, 20));

    // 3. Click Hang up
    const hangupBtn = overlay.querySelector('.pcl-hangup');
    hangupBtn.click();
    await new Promise(r => setTimeout(r, 20));

    const endCallRpc = rpcLog.find(r => r.call === 'callEnd');
    assert.ok(endCallRpc, 'callEnd RPC executed');
    assert.strictEqual(endCallRpc.id, 'call-101');
    assert.strictEqual(localStream.getTracks()[0].stopped, true, 'Audio tracks stopped');
    assert.strictEqual(document.querySelector('.pcl-overlay'), null, 'Overlay removed');

    calls.stop();
  });

  // --- Test 5: timeout path calls callTimeout ---
  await test('caller ring timeout calls callTimeout RPC', async () => {
    const rpcLog = [];
    let timeoutCb = null;

    const mockSocial = {
      async callStart(other, offer) { return 'call-202'; },
      async callIce() {},
      async call() { return { id: 'call-202', status: 'ringing' }; },
      async callTimeout(id) { rpcLog.push({ call: 'callTimeout', id }); }
    };

    const env = {
      RTCPeerConnection: FakeRTCPeerConnection,
      getUserMedia: async () => new FakeStream(),
      setTimeout: (fn, ms) => {
        if (ms === 45000) timeoutCb = fn;
        return 123;
      },
      clearTimeout: () => {},
      setInterval: () => 456,
      clearInterval: () => {}
    };

    const calls = callui.createCalls({ social: mockSocial }, env);
    await calls.start('user-bob');

    assert.ok(timeoutCb, '45s ring timeout scheduled');
    await timeoutCb(); // Trigger timeout manually

    assert.strictEqual(rpcLog.length, 1);
    assert.strictEqual(rpcLog[0].call, 'callTimeout');
    assert.strictEqual(rpcLog[0].id, 'call-202');

    calls.stop();
  });

  // --- Test 6: callee accept/decline ---
  await test('callee watchIncoming accept and decline flows', async () => {
    const rpcLog = [];
    let ringingCall = { id: 'call-303', caller: 'user-carol', status: 'ringing', offer: JSON.stringify({ type: 'offer' }) };

    const mockSocial = {
      async ringingForMe() { return ringingCall; },
      async callAnswer(id, answer) { rpcLog.push({ call: 'callAnswer', id }); },
      async callEnd(id) { rpcLog.push({ call: 'callEnd', id }); },
      async callIce() {},
      async call(id) { return ringingCall; }
    };

    let watchCb = null;
    const env = {
      RTCPeerConnection: FakeRTCPeerConnection,
      getUserMedia: async () => new FakeStream(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
      setInterval: (fn, ms) => {
        if (ms === 4000) watchCb = fn;
        return 789;
      },
      clearInterval: () => {}
    };

    const calls = callui.createCalls({ social: mockSocial, getFriendName: () => 'Carol' }, env);
    calls.watchIncoming();

    assert.ok(watchCb, 'watchIncoming polling scheduled');
    await watchCb();

    let banner = document.querySelector('.pcl-banner');
    assert.ok(banner, 'Ringing banner rendered');
    assert.ok(banner.textContent.includes('Carol is calling'), 'Banner shows caller name');

    // Test Decline
    const declineBtn = banner.querySelector('.pcl-decline');
    declineBtn.click();
    await new Promise(r => setTimeout(r, 10));

    assert.strictEqual(rpcLog[0].call, 'callEnd');
    assert.strictEqual(rpcLog[0].id, 'call-303');
    assert.strictEqual(document.querySelector('.pcl-banner'), null, 'Banner removed on decline');

    // Test Accept
    rpcLog.length = 0;
    await watchCb(); // Trigger incoming ring again
    banner = document.querySelector('.pcl-banner');
    assert.ok(banner, 'Ringing banner rendered again');

    const acceptBtn = banner.querySelector('.pcl-accept');
    await acceptBtn.click();
    await new Promise(r => setTimeout(r, 20));

    assert.strictEqual(rpcLog[0].call, 'callAnswer');
    assert.strictEqual(rpcLog[0].id, 'call-303');
    assert.ok(document.querySelector('.pcl-overlay'), 'In-call overlay shown on accept');

    calls.stop();
  });

  // --- Test 7: second call refused ---
  await test('starting a call while already in a call is refused', async () => {
    let callStarts = 0;
    const mockSocial = {
      async callStart() { callStarts++; return 'call-404'; },
      async callIce() {},
      async call() { return { status: 'ringing' }; }
    };

    const env = {
      RTCPeerConnection: FakeRTCPeerConnection,
      getUserMedia: async () => new FakeStream(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
      setInterval: () => 1,
      clearInterval: () => {}
    };

    const calls = callui.createCalls({ social: mockSocial }, env);
    await calls.start('user-dave');
    assert.strictEqual(callStarts, 1, 'First call started');

    // Try second call
    await calls.start('user-eve');
    assert.strictEqual(callStarts, 1, 'Second call not initiated');

    const toast = document.querySelector('.pcl-toast');
    assert.ok(toast, 'Toast message displayed');
    assert.ok(toast.textContent.includes('You are already on a call.'), 'Toast text correct');

    calls.stop();
  });

  // --- Test 8: mic denied message ---
  await test('mic denied shows error toast', async () => {
    const mockSocial = { async callStart() {} };
    const env = {
      RTCPeerConnection: FakeRTCPeerConnection,
      getUserMedia: async () => { throw new Error('NotAllowedError'); },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: () => {},
      setInterval: () => 1,
      clearInterval: () => {}
    };

    const calls = callui.createCalls({ social: mockSocial }, env);
    await calls.start('user-frank');

    const toast = document.querySelector('.pcl-toast');
    assert.ok(toast, 'Toast message displayed');
    assert.strictEqual(toast.textContent, 'Allow the microphone to call.');

    calls.stop();
  });

  // --- Test 9: hostile names never become elements ---
  await test('hostile names are safely escaped with textContent only', async () => {
    const hostileName = '<script>alert("xss")</script><img src=x onerror=alert(1)>';

    const mockSocial = {
      async notifications() {
        return [{ id: 1, kind: 'message', from_user: 'u1', info: hostileName, seen: false }];
      },
      async prefs() { return { notify: true }; },
      async callStart() { return 'call-505'; },
      async callIce() {},
      async call() { return { status: 'ringing' }; }
    };

    // 1. Bell dropdown
    const host = document.createElement('div');
    const bell = callui.mountBell(host, { social: mockSocial });
    await bell.refresh();
    const bellBtn = host.querySelector('button'); if (bellBtn) bellBtn.click(); await new Promise(r => setTimeout(r, 50));
    const itemText = host.querySelector('.pcl-note-text') || host.querySelector('.pcl-note, [class*=note]');
    assert.ok(itemText.textContent.includes(hostileName), 'Hostile text stored as string');
    assert.strictEqual(host.querySelector('script'), null, 'No script element created in DOM');
    assert.strictEqual(host.querySelector('img'), null, 'No img element created in DOM');
    bell.stop();

    // 2. Call overlay
    const env = {
      RTCPeerConnection: FakeRTCPeerConnection,
      getUserMedia: async () => new FakeStream(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: () => {},
      setInterval: () => 1,
      clearInterval: () => {}
    };

    const calls = callui.createCalls({ social: mockSocial }, env);
    await calls.start({ id: 'u1', name: hostileName });

    const nameEl = document.querySelector('.pcl-name');
    assert.strictEqual(nameEl.textContent, hostileName, 'Hostile name stored as plain text');
    assert.strictEqual(document.querySelector('script'), null, 'No script element created');
    assert.strictEqual(document.querySelector('img'), null, 'No img element created');

    calls.stop();
  });

  console.log(`\nAll ${passed} tests passed successfully!`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
