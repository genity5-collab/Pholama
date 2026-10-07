import { makeSocial, notificationText, callStatusText, formatClock, socialFriendly } from './social.js';

let userGestured = false;
if (typeof window !== 'undefined') {
  const markGesture = () => { userGestured = true; };
  for (const ev of ['click', 'keydown', 'pointerdown', 'touchstart']) {
    window.addEventListener(ev, markGesture, { capture: true, once: true });
  }
}

export function ding() {
  try {
    const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const t0 = ctx.currentTime || 0;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, t0);
    gain1.gain.setValueAtTime(0.08, t0);
    gain1.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(t0);
    osc1.stop(t0 + 0.1);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, t0 + 0.1);
    gain2.gain.setValueAtTime(0.08, t0 + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(t0 + 0.1);
    osc2.stop(t0 + 0.25);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 350);
  } catch (e) {
    // Audio block or missing WebAudio
  }
}

export function installCallStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('pcl-styles')) return;
  const style = document.createElement('style');
  style.id = 'pcl-styles';
  style.textContent = callStyles();
  (document.head || document.documentElement || document.body).appendChild(style);
}

export function callStyles() {
  return `
.pcl-bell-wrap { position: relative; display: inline-block; }
.pcl-bell-btn { position: relative; background: transparent; border: 1px solid var(--line); border-radius: 999px; width: 40px; height: 40px; font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.pcl-bell-btn:hover { background: var(--card2); }
.pcl-badge { position: absolute; top: -4px; right: -4px; background: var(--err); color: #fff; font-size: 11px; font-weight: bold; border-radius: 999px; padding: 1px 6px; min-width: 16px; text-align: center; }
.pcl-dropdown { position: absolute; right: 0; top: 46px; width: 300px; max-height: 380px; overflow-y: auto; background: var(--card); border: 1px solid var(--line); border-radius: var(--r); box-shadow: 0 8px 24px rgba(0,0,0,0.15); z-index: 100; padding: 12px; }
.pcl-dropdown-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
.pcl-clear-btn { background: transparent; border: 0; color: var(--mut); font-size: 12px; cursor: pointer; }
.pcl-clear-btn:hover { color: var(--fg); }
.pcl-empty { color: var(--mut); font-size: 13px; text-align: center; padding: 16px 0; }
.pcl-note-list { display: flex; flex-direction: column; gap: 6px; }
.pcl-note-item { padding: 8px 10px; border-radius: 8px; background: var(--bg); cursor: pointer; transition: background 0.15s; }
.pcl-note-item:hover { background: var(--card2); }
.pcl-note-item.pcl-unread { border-left: 3px solid var(--acc); font-weight: 500; }
.pcl-note-text { font-size: 13px; color: var(--fg); overflow-wrap: anywhere; }
.pcl-note-time { color: var(--mut); font-size: 11px; display: block; margin-top: 2px; }

.pcl-banner { position: fixed; top: 0; left: 0; right: 0; background: var(--acc); color: var(--acct); padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; z-index: 999; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
.pcl-banner-text { font-weight: 600; font-size: 15px; }
.pcl-banner-actions { display: flex; gap: 10px; }
.pcl-btn { border: 0; border-radius: 999px; padding: 6px 16px; font-weight: 600; cursor: pointer; font-size: 13px; }
.pcl-accept { background: var(--ok); color: #fff; }
.pcl-decline, .pcl-hangup { background: var(--err); color: #fff; }
.pcl-mute { background: var(--card2); color: var(--fg); border: 1px solid var(--line); }
.pcl-muted { background: var(--warn); color: #fff; }

.pcl-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.pcl-card { background: var(--card); border: 1px solid var(--line); border-radius: 20px; padding: 24px; width: 320px; text-align: center; box-shadow: 0 12px 36px rgba(0,0,0,0.25); }
.pcl-name { margin: 0 0 6px; font-size: 20px; }
.pcl-status { color: var(--mut); font-size: 14px; margin-bottom: 12px; }
.pcl-timer { font-size: 28px; font-weight: 700; margin: 12px 0 20px; font-variant-numeric: tabular-nums; }
.pcl-actions { display: flex; justify-content: center; gap: 12px; }

.pcl-toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: var(--err); color: #fff; padding: 10px 20px; border-radius: 999px; font-size: 14px; font-weight: 500; z-index: 1001; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }

.pcl-settings { padding: 12px 0; }
.pcl-sw-list { display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px; }
.pcl-sw-row { display: flex; justify-content: space-between; align-items: center; padding: 12px; background: var(--card); border: 1px solid var(--line); border-radius: var(--r); }
.pcl-sw-text { flex: 1; padding-right: 12px; }
.pcl-sw-title { font-weight: 600; font-size: 15px; color: var(--fg); }
.pcl-sw-desc { color: var(--mut); font-size: 13px; display: block; margin-top: 2px; }
.pcl-switch { position: relative; width: 48px; height: 26px; border-radius: 999px; background: var(--line); border: 0; cursor: pointer; padding: 2px; transition: background 0.2s; }
.pcl-switch.pcl-on { background: var(--acc); }
.pcl-switch-knob { display: block; width: 22px; height: 22px; border-radius: 50%; background: #fff; transition: transform 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
.pcl-switch.pcl-on .pcl-switch-knob { transform: translateX(22px); }
.pcl-settings-err { color: var(--err); font-size: 13.5px; min-height: 1.2em; margin-bottom: 12px; }
.pcl-settings-info { color: var(--mut); font-size: 13px; margin: 0; }
  `;
}

export function mountBell(host, ctx) {
  installCallStyles();
  host.textContent = '';
  const S = ctx.social || makeSocial(ctx.Account, ctx.cfg);

  const container = document.createElement('div');
  container.className = 'pcl-bell-wrap';

  const bellBtn = document.createElement('button');
  bellBtn.type = 'button';
  bellBtn.className = 'pcl-bell-btn';
  bellBtn.setAttribute('aria-label', 'Notifications');
  bellBtn.textContent = '🔔';

  const badge = document.createElement('span');
  badge.className = 'pcl-badge';
  badge.hidden = true;
  bellBtn.appendChild(badge);

  const dropdown = document.createElement('div');
  dropdown.className = 'pcl-dropdown';
  dropdown.hidden = true;

  container.appendChild(bellBtn);
  container.appendChild(dropdown);
  host.appendChild(container);

  let prevUnreadCount = null;
  let currentNotes = [];

  function renderDropdown() {
    dropdown.textContent = '';

    const header = document.createElement('div');
    header.className = 'pcl-dropdown-head';
    const title = document.createElement('b');
    title.textContent = 'Notifications';
    header.appendChild(title);

    if (currentNotes.length > 0) {
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'pcl-clear-btn';
      clearBtn.textContent = 'Clear all';
      clearBtn.onclick = async () => {
        try {
          await S.clearNotifications();
          currentNotes = [];
          badge.hidden = true;
          prevUnreadCount = 0;
          renderDropdown();
        } catch (e) {}
      };
      header.appendChild(clearBtn);
    }
    dropdown.appendChild(header);

    if (currentNotes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'pcl-empty';
      empty.textContent = 'No notifications';
      dropdown.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'pcl-note-list';

    for (const n of currentNotes) {
      const item = document.createElement('div');
      item.className = 'pcl-note-item' + (n.seen ? '' : ' pcl-unread');

      const textSpan = document.createElement('div');
      textSpan.className = 'pcl-note-text';
      textSpan.textContent = notificationText(n);

      const timeSpan = document.createElement('small');
      timeSpan.className = 'pcl-note-time';
      if (n.created_at) {
        try {
          timeSpan.textContent = new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch {
          timeSpan.textContent = '';
        }
      }

      item.appendChild(textSpan);
      item.appendChild(timeSpan);

      item.onclick = () => {
        dropdown.hidden = true;
        const refUser = n.from_user || n.ref_user;
        if (n.kind === 'friend_request' || n.kind === 'friend_accepted') {
          if (ctx.onOpenFriends) ctx.onOpenFriends();
        } else if (n.kind === 'message' || n.kind === 'missed_call') {
          if (ctx.onOpenChat && refUser) ctx.onOpenChat(refUser);
        } else {
          if (refUser && ctx.onOpenChat) ctx.onOpenChat(refUser);
          else if (ctx.onOpenFriends) ctx.onOpenFriends();
        }
      };

      list.appendChild(item);
    }
    dropdown.appendChild(list);
  }

  async function refresh() {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (host && host.isConnected === false) return;

    try {
      const [notes, prefs] = await Promise.all([
        S.notifications().catch(() => []),
        S.prefs().catch(() => ({}))
      ]);
      currentNotes = notes || [];
      const unreadCount = currentNotes.filter(n => !n.seen).length;

      if (unreadCount > 0) {
        badge.textContent = String(unreadCount);
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }

      if (prevUnreadCount !== null && unreadCount > prevUnreadCount) {
        if ((userGestured || ctx.userGestured) && prefs && prefs.notify) {
          ding();
        }
      }
      prevUnreadCount = unreadCount;

      if (!dropdown.hidden) {
        renderDropdown();
      }
    } catch (e) {}
  }

  bellBtn.onclick = async () => {
    const opening = dropdown.hidden;
    dropdown.hidden = !opening;
    if (opening) {
      try {
        await S.markNotificationsSeen();
      } catch (e) {}
      await refresh();
    }
  };

  refresh();
  const timer = setInterval(() => {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (host && host.isConnected === false) return;
    refresh();
  }, 15000);

  return {
    refresh,
    stop() {
      clearInterval(timer);
    }
  };
}

let activeCall = null;
let incomingTimer = null;
let incomingBannerEl = null;

function showToastMessage(msg) {
  if (typeof document === 'undefined') return;
  let toast = document.querySelector('.pcl-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'pcl-toast';
    (document.body || document.documentElement).appendChild(toast);
  }
  toast.textContent = msg;
  toast.hidden = false;
  setTimeout(() => {
    if (toast) toast.hidden = true;
  }, 3000);
}

function playRingTone(env) {
  let active = true;
  const setInt = env?.setInterval || globalThis.setInterval.bind(globalThis);
  const clearInt = env?.clearInterval || globalThis.clearInterval.bind(globalThis);
  const setTimer = env?.setTimeout || globalThis.setTimeout.bind(globalThis);

  function tone() {
    if (!active) return;
    try {
      const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const t0 = ctx.currentTime || 0;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, t0);
      gain.gain.setValueAtTime(0.08, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 1.0);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 1.0);
      setTimer(() => ctx.close().catch(() => {}), 1200);
    } catch (e) {}
  }

  tone();
  const intervalId = setInt(tone, 2000);

  return function stopRingTone() {
    active = false;
    if (intervalId) clearInt(intervalId);
  };
}

function renderCallOverlay({ friendName, status, onHangup }) {
  installCallStyles();
  const overlay = document.createElement('div');
  overlay.className = 'pcl-overlay';

  const card = document.createElement('div');
  card.className = 'pcl-card';

  const nameEl = document.createElement('h3');
  nameEl.className = 'pcl-name';
  nameEl.textContent = friendName;

  const statusEl = document.createElement('div');
  statusEl.className = 'pcl-status';
  statusEl.textContent = callStatusText(status);

  const timerEl = document.createElement('div');
  timerEl.className = 'pcl-timer';
  timerEl.textContent = '0:00';

  const actions = document.createElement('div');
  actions.className = 'pcl-actions';

  const muteBtn = document.createElement('button');
  muteBtn.type = 'button';
  muteBtn.className = 'pcl-btn pcl-mute';
  muteBtn.textContent = 'Mute';

  let muted = false;
  muteBtn.onclick = () => {
    muted = !muted;
    if (activeCall && activeCall.stream && activeCall.stream.getAudioTracks) {
      activeCall.stream.getAudioTracks().forEach(t => { t.enabled = !muted; });
    } else if (activeCall && activeCall.stream && activeCall.stream.getTracks) {
      activeCall.stream.getTracks().forEach(t => { t.enabled = !muted; });
    }
    muteBtn.textContent = muted ? 'Unmute' : 'Mute';
    muteBtn.classList.toggle('pcl-muted', muted);
  };

  const hangupBtn = document.createElement('button');
  hangupBtn.type = 'button';
  hangupBtn.className = 'pcl-btn pcl-hangup';
  hangupBtn.textContent = 'Hang up';
  hangupBtn.onclick = onHangup;

  const audioEl = document.createElement('audio');
  audioEl.autoplay = true;
  audioEl.playsInline = true;
  audioEl.style.display = 'none';

  actions.appendChild(muteBtn);
  actions.appendChild(hangupBtn);

  card.appendChild(nameEl);
  card.appendChild(statusEl);
  card.appendChild(timerEl);
  card.appendChild(actions);
  card.appendChild(audioEl);
  overlay.appendChild(card);

  (document.body || document.documentElement).appendChild(overlay);

  return {
    audioEl,
    updateStatus(s) {
      statusEl.textContent = callStatusText(s);
    },
    updateTimer(t) {
      timerEl.textContent = t;
    },
    remove() {
      overlay.remove();
    }
  };
}

export function createCalls(ctx, env = {}) {
  const S = ctx.social || makeSocial(ctx.Account, ctx.cfg);

  const PCClass = env.RTCPeerConnection || globalThis.RTCPeerConnection;
  const getUserMediaFn = env.getUserMedia || (constraints => globalThis.navigator?.mediaDevices?.getUserMedia(constraints));
  const setTimer = env.setTimeout || globalThis.setTimeout.bind(globalThis);
  const clearTimer = env.clearTimeout || globalThis.clearTimeout.bind(globalThis);
  const setInt = env.setInterval || globalThis.setInterval.bind(globalThis);
  const clearInt = env.clearInterval || globalThis.clearInterval.bind(globalThis);

  function cleanupActiveCall() {
    if (!activeCall) return;
    const { pc, stream, overlay, pollTimer, ringTimer, clockTimer } = activeCall;

    if (pollTimer) clearInt(pollTimer);
    if (ringTimer) clearTimer(ringTimer);
    if (clockTimer) clearInt(clockTimer);

    if (stream) {
      if (stream.getTracks) stream.getTracks().forEach(t => t.stop && t.stop());
      else if (stream.getAudioTracks) stream.getAudioTracks().forEach(t => t.stop && t.stop());
    }
    if (pc && pc.close) {
      try { pc.close(); } catch (e) {}
    }
    if (overlay) {
      overlay.remove();
    }
    activeCall = null;
  }

  async function endActiveCall(reason = 'ended') {
    if (!activeCall) return;
    const callId = activeCall.id;
    try {
      await S.callEnd(callId);
    } catch (e) {}
    cleanupActiveCall();
  }

  function startCallClock() {
    if (!activeCall) return;
    activeCall.elapsedSec = 0;
    activeCall.clockTimer = setInt(() => {
      if (!activeCall) return;
      activeCall.elapsedSec += 1;
      if (activeCall.overlay) {
        activeCall.overlay.updateTimer(formatClock(activeCall.elapsedSec));
      }
    }, 1000);
  }

  return {
    async start(friend) {
      if (activeCall) {
        showToastMessage('You are already on a call.');
        return;
      }

      const otherId = typeof friend === 'string' ? friend : (friend?.id || friend?.other || friend?.user_id || friend?.from_user || '');
      const friendName = (friend && typeof friend === 'object' && friend.name) || (ctx.getFriendName ? ctx.getFriendName(otherId) : '') || otherId || 'Friend';

      let stream;
      try {
        stream = await getUserMediaFn({ audio: true });
      } catch (err) {
        showToastMessage('Allow the microphone to call.');
        return;
      }

      // Strict networks may fail without TURN server
      const pc = new PCClass({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      if (stream) {
        const tracks = stream.getTracks ? stream.getTracks() : (stream.getAudioTracks ? stream.getAudioTracks() : []);
        for (const t of tracks) {
          if (pc.addTrack) pc.addTrack(t, stream);
        }
      }

      let offer;
      try {
        offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
      } catch (err) {
        if (stream && stream.getTracks) stream.getTracks().forEach(t => t.stop && t.stop());
        if (pc.close) pc.close();
        showToastMessage(socialFriendly(err));
        return;
      }

      let callId;
      try {
        const sdpOffer = JSON.stringify(pc.localDescription || offer);
        callId = await S.callStart(otherId, sdpOffer);
      } catch (err) {
        if (stream && stream.getTracks) stream.getTracks().forEach(t => t.stop && t.stop());
        if (pc.close) pc.close();
        showToastMessage(socialFriendly(err));
        return;
      }

      pc.onicecandidate = (e) => {
        if (e && e.candidate) {
          S.callIce(callId, JSON.stringify(e.candidate)).catch(() => {});
        }
      };

      const overlay = renderCallOverlay({
        friendName,
        status: 'ringing',
        onHangup: () => endActiveCall('cancelled')
      });

      pc.ontrack = (e) => {
        if (e && e.streams && e.streams[0] && overlay.audioEl) {
          overlay.audioEl.srcObject = e.streams[0];
        }
      };

      activeCall = {
        id: callId,
        role: 'caller',
        otherId,
        friendName,
        pc,
        stream,
        overlay,
        status: 'ringing',
        appliedIce: new Set(),
        elapsedSec: 0,
        pollTimer: null,
        ringTimer: null,
        clockTimer: null
      };

      activeCall.ringTimer = setTimer(async () => {
        if (activeCall && activeCall.status === 'ringing') {
          try {
            await S.callTimeout(callId);
          } catch (e) {}
          cleanupActiveCall();
        }
      }, 45000);

      async function pollCaller() {
        if (!activeCall || activeCall.id !== callId) return;
        try {
          const row = await S.call(callId);
          if (!row || !activeCall) return;

          if (row.status === 'answered' && activeCall.status !== 'answered') {
            activeCall.status = 'answered';
            if (activeCall.ringTimer) clearTimer(activeCall.ringTimer);
            overlay.updateStatus('answered');
            startCallClock();

            if (row.answer && (!pc.remoteDescription || pc.signalingState !== 'stable')) {
              const ansObj = typeof row.answer === 'string' ? JSON.parse(row.answer) : row.answer;
              await pc.setRemoteDescription(ansObj);
            }
          }

          if (row.ice_callee && Array.isArray(row.ice_callee)) {
            for (const iceStr of row.ice_callee) {
              if (!activeCall.appliedIce.has(iceStr)) {
                activeCall.appliedIce.add(iceStr);
                if (pc.addIceCandidate) {
                  const iceObj = typeof iceStr === 'string' ? JSON.parse(iceStr) : iceStr;
                  pc.addIceCandidate(iceObj).catch(() => {});
                }
              }
            }
          }

          if (row.status !== 'ringing' && row.status !== 'answered') {
            overlay.updateStatus(row.status);
            cleanupActiveCall();
          }
        } catch (e) {}
      }

      activeCall.pollTimer = setInt(pollCaller, 1500);
    },

    watchIncoming() {
      if (incomingTimer) return;

      async function pollIncoming() {
        if (typeof document !== 'undefined' && document.hidden) return;
        if (activeCall || incomingBannerEl) return;

        try {
          const row = await S.ringingForMe();
          if (!row || activeCall || incomingBannerEl) return;

          const callerName = (ctx.getFriendName ? ctx.getFriendName(row.caller) : '') || row.caller || 'Someone';
          const stopRingTone = playRingTone(env);

          incomingBannerEl = document.createElement('div');
          incomingBannerEl.className = 'pcl-banner';

          const text = document.createElement('span');
          text.className = 'pcl-banner-text';
          text.textContent = callerName + ' is calling';

          const actions = document.createElement('div');
          actions.className = 'pcl-banner-actions';

          const acceptBtn = document.createElement('button');
          acceptBtn.type = 'button';
          acceptBtn.className = 'pcl-btn pcl-accept';
          acceptBtn.textContent = 'Accept';

          const declineBtn = document.createElement('button');
          declineBtn.type = 'button';
          declineBtn.className = 'pcl-btn pcl-decline';
          declineBtn.textContent = 'Decline';

          const removeBanner = () => {
            stopRingTone();
            if (incomingBannerEl) {
              incomingBannerEl.remove();
              incomingBannerEl = null;
            }
          };

          declineBtn.onclick = async () => {
            removeBanner();
            try { await S.callEnd(row.id); } catch (e) {}
          };

          acceptBtn.onclick = async () => {
            removeBanner();
            if (activeCall) {
              showToastMessage('You are already on a call.');
              return;
            }

            let stream;
            try {
              stream = await getUserMediaFn({ audio: true });
            } catch (err) {
              showToastMessage('Allow the microphone to call.');
              try { await S.callEnd(row.id); } catch (e) {}
              return;
            }

            // Strict networks may fail without TURN server
            const pc = new PCClass({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
            if (stream) {
              const tracks = stream.getTracks ? stream.getTracks() : (stream.getAudioTracks ? stream.getAudioTracks() : []);
              for (const t of tracks) {
                if (pc.addTrack) pc.addTrack(t, stream);
              }
            }

            pc.onicecandidate = (e) => {
              if (e && e.candidate) {
                S.callIce(row.id, JSON.stringify(e.candidate)).catch(() => {});
              }
            };

            const overlay = renderCallOverlay({
              friendName: callerName,
              status: 'answered',
              onHangup: () => endActiveCall('ended')
            });

            pc.ontrack = (e) => {
              if (e && e.streams && e.streams[0] && overlay.audioEl) {
                overlay.audioEl.srcObject = e.streams[0];
              }
            };

            activeCall = {
              id: row.id,
              role: 'callee',
              otherId: row.caller,
              friendName: callerName,
              pc,
              stream,
              overlay,
              status: 'answered',
              appliedIce: new Set(),
              elapsedSec: 0,
              pollTimer: null,
              ringTimer: null,
              clockTimer: null
            };

            try {
              if (row.offer) {
                const offerObj = typeof row.offer === 'string' ? JSON.parse(row.offer) : row.offer;
                await pc.setRemoteDescription(offerObj);
              }
              if (row.ice_caller && Array.isArray(row.ice_caller)) {
                for (const iceStr of row.ice_caller) {
                  if (!activeCall.appliedIce.has(iceStr)) {
                    activeCall.appliedIce.add(iceStr);
                    if (pc.addIceCandidate) {
                      const iceObj = typeof iceStr === 'string' ? JSON.parse(iceStr) : iceStr;
                      pc.addIceCandidate(iceObj).catch(() => {});
                    }
                  }
                }
              }

              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              await S.callAnswer(row.id, JSON.stringify(pc.localDescription || answer));

              startCallClock();

              async function pollCallee() {
                if (!activeCall || activeCall.id !== row.id) return;
                try {
                  const current = await S.call(row.id);
                  if (!current || !activeCall) return;

                  if (current.ice_caller && Array.isArray(current.ice_caller)) {
                    for (const iceStr of current.ice_caller) {
                      if (!activeCall.appliedIce.has(iceStr)) {
                        activeCall.appliedIce.add(iceStr);
                        if (pc.addIceCandidate) {
                          const iceObj = typeof iceStr === 'string' ? JSON.parse(iceStr) : iceStr;
                          pc.addIceCandidate(iceObj).catch(() => {});
                        }
                      }
                    }
                  }

                  if (current.status !== 'ringing' && current.status !== 'answered') {
                    overlay.updateStatus(current.status);
                    cleanupActiveCall();
                  }
                } catch (e) {}
              }

              activeCall.pollTimer = setInt(pollCallee, 1500);

            } catch (err) {
              cleanupActiveCall();
              showToastMessage(socialFriendly(err));
            }
          };

          actions.appendChild(acceptBtn);
          actions.appendChild(declineBtn);
          incomingBannerEl.appendChild(text);
          incomingBannerEl.appendChild(actions);
          (document.body || document.documentElement).appendChild(incomingBannerEl);

        } catch (e) {}
      }

      incomingTimer = setInt(pollIncoming, 4000);
    },

    stop() {
      if (incomingTimer) {
        clearInt(incomingTimer);
        incomingTimer = null;
      }
      if (incomingBannerEl) {
        incomingBannerEl.remove();
        incomingBannerEl = null;
      }
      if (activeCall) {
        endActiveCall('ended');
      }
    }
  };
}

export async function mountSocialSettings(host, ctx) {
  installCallStyles();
  host.textContent = '';
  const S = ctx.social || makeSocial(ctx.Account, ctx.cfg);

  const container = document.createElement('div');
  container.className = 'pcl-settings';

  const errEl = document.createElement('div');
  errEl.className = 'pcl-settings-err';

  let prefs = { allow_requests: true, allow_dms: true, allow_calls: true, notify: true };
  try {
    const loaded = await S.prefs();
    if (loaded) prefs = { ...prefs, ...loaded };
  } catch (e) {
    errEl.textContent = socialFriendly(e);
  }

  const SWITCHES = [
    { key: 'allow_requests', label: 'Friend requests', desc: 'Allow other people to send you friend requests.' },
    { key: 'allow_dms', label: 'Private messages', desc: 'Allow accepted friends to send you private messages.' },
    { key: 'allow_calls', label: 'Calls', desc: 'Allow accepted friends to start voice calls with you.' },
    { key: 'notify', label: 'Notifications and sound', desc: 'Show notification badges and play sound effects.' },
  ];

  const list = document.createElement('div');
  list.className = 'pcl-sw-list';

  for (const sw of SWITCHES) {
    const row = document.createElement('div');
    row.className = 'pcl-sw-row';

    const textDiv = document.createElement('div');
    textDiv.className = 'pcl-sw-text';

    const title = document.createElement('div');
    title.className = 'pcl-sw-title';
    title.textContent = sw.label;

    const desc = document.createElement('small');
    desc.className = 'pcl-sw-desc';
    desc.textContent = sw.desc;

    textDiv.appendChild(title);
    textDiv.appendChild(desc);

    const switchBtn = document.createElement('button');
    switchBtn.type = 'button';
    switchBtn.setAttribute('role', 'switch');
    switchBtn.className = 'pcl-switch' + (prefs[sw.key] ? ' pcl-on' : '');
    switchBtn.setAttribute('aria-checked', prefs[sw.key] ? 'true' : 'false');
    switchBtn.setAttribute('aria-label', sw.label);

    const knob = document.createElement('span');
    knob.className = 'pcl-switch-knob';
    switchBtn.appendChild(knob);

    switchBtn.onclick = async () => {
      errEl.textContent = '';
      const oldVal = prefs[sw.key];
      const newVal = !oldVal;

      prefs[sw.key] = newVal;
      switchBtn.setAttribute('aria-checked', newVal ? 'true' : 'false');
      switchBtn.classList.toggle('pcl-on', newVal);

      try {
        await S.savePrefs({ ...prefs });
      } catch (err) {
        prefs[sw.key] = oldVal;
        switchBtn.setAttribute('aria-checked', oldVal ? 'true' : 'false');
        switchBtn.classList.toggle('pcl-on', oldVal);
        errEl.textContent = socialFriendly(err);
      }
    };

    row.appendChild(textDiv);
    row.appendChild(switchBtn);
    list.appendChild(row);
  }

  const infoP = document.createElement('p');
  infoP.className = 'pcl-settings-info';
  infoP.textContent = 'Blocking someone stops their messages and calls and hides you from them.';

  container.appendChild(list);
  container.appendChild(errEl);
  container.appendChild(infoP);

  host.appendChild(container);
}
