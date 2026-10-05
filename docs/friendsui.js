// Pholama Platform: Friends and Private Chat UI
import { makeSocial, relation, sortFriends, unreadTotal, socialFriendly, dmProblem, isVideoPath } from './social.js';
import { attachPicker, lazyMedia, installMediaStyles } from './mediaui.js';

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

function avatarCircle(url, name) {
  const w = el('div', 'pfr-avatar');
  if (url && /^https:\/\//.test(url)) {
    const i = document.createElement('img');
    i.alt = '';
    i.loading = 'lazy';
    i.referrerPolicy = 'no-referrer';
    i.src = url;
    i.onerror = () => {
      i.remove();
      w.textContent = (name || '?').slice(0, 1).toUpperCase();
    };
    w.append(i);
  } else {
    w.textContent = (name || '?').slice(0, 1).toUpperCase();
  }
  return w;
}

export function chatGroups(messages, myId) {
  if (!Array.isArray(messages)) return [];
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;

  return messages.map(m => {
    const mine = m.sender === myId;
    let d = m.created_at ? new Date(m.created_at) : new Date();
    if (isNaN(d.getTime())) d = new Date();

    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const showTime = `${hours}:${minutes}`;

    const msgDateStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    let dayLabel = '';
    if (msgDateStart === todayStart) {
      dayLabel = 'Today';
    } else if (msgDateStart === yesterdayStart) {
      dayLabel = 'Yesterday';
    } else {
      dayLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    return {
      ...m,
      mine,
      showTime,
      dayLabel
    };
  });
}

export function friendsStyles() {
  return `
.pfr-wrap { display: flex; flex-direction: column; gap: 16px; width: 100%; max-width: 1000px; margin: 0 auto; color: var(--fg); font-family: inherit; }
.pfr-add-card { display: flex; flex-direction: column; gap: 10px; background: var(--card); border: 1px solid var(--line); border-radius: var(--r); padding: 14px 18px; }
.pfr-add-card h3 { margin: 0; font-size: 16px; font-weight: 600; }
.pfr-add-row { display: flex; gap: 10px; align-items: center; }
.pfr-add-row input { flex: 1; min-height: 38px; }
.pfr-status { font-size: 13.5px; min-height: 1.2em; color: var(--mut); }
.pfr-status.pfr-err { color: var(--err); }
.pfr-status.pfr-ok { color: var(--ok); }

.pfr-layout { display: flex; gap: 16px; min-height: 480px; align-items: stretch; }
.pfr-sidebar { flex: 1; min-width: 280px; display: flex; flex-direction: column; gap: 16px; }
.pfr-chat-panel { flex: 1.4; min-width: 300px; display: flex; flex-direction: column; height: 560px; background: var(--card); border: 1px solid var(--line); border-radius: var(--r); overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,0.06); }

.pfr-section { display: flex; flex-direction: column; gap: 8px; background: var(--card); border: 1px solid var(--line); border-radius: var(--r); padding: 12px 14px; }
.pfr-section-title { font-size: 13px; font-weight: 700; color: var(--mut); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
.pfr-empty { font-size: 14px; color: var(--mut); margin: 4px 0; font-style: italic; }

.pfr-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 12px; background: var(--card2); }
.pfr-item-info { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.pfr-avatar { width: 34px; height: 34px; border-radius: 50%; background: var(--line); color: var(--fg); display: grid; place-items: center; font-weight: 700; font-size: 14px; flex-shrink: 0; overflow: hidden; }
.pfr-avatar img { width: 100%; height: 100%; object-fit: cover; }
.pfr-name { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 6px; }
.pfr-badge { font-size: 11px; background: var(--acc); color: var(--acct); padding: 2px 7px; border-radius: 999px; font-weight: 700; }

.pfr-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.pfr-confirm-box { display: flex; gap: 6px; align-items: center; font-size: 13px; background: var(--bg); padding: 4px 8px; border-radius: 999px; border: 1px solid var(--line); }

.pfr-chat-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--line); background: var(--card); min-height: 52px; }
.pfr-chat-header h3 { margin: 0; font-size: 16px; font-weight: 600; }
.pfr-chat-body { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; background: var(--bg); }
.pfr-chat-empty { display: grid; place-items: center; height: 100%; color: var(--mut); font-size: 14px; text-align: center; padding: 20px; }

.pfr-day-label { text-align: center; font-size: 11.5px; color: var(--mut); font-weight: 600; margin: 8px 0 2px; position: sticky; top: 0; background: var(--bg); padding: 3px 10px; align-self: center; border-radius: 999px; border: 1px solid var(--line); }

.pfr-msg { display: flex; flex-direction: column; max-width: 82%; gap: 3px; }
.pfr-msg.pfr-mine { align-self: flex-end; align-items: flex-end; }
.pfr-msg.pfr-theirs { align-self: flex-start; align-items: flex-start; }

.pfr-bub { padding: 9px 14px; border-radius: 18px; font-size: 14.5px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
.pfr-msg.pfr-mine .pfr-bub { background: var(--acc); color: var(--acct); border-bottom-right-radius: 4px; }
.pfr-msg.pfr-theirs .pfr-bub { background: var(--card); color: var(--fg); border: 1px solid var(--line); border-bottom-left-radius: 4px; }

.pfr-msg-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--mut); margin: 0 4px; }
.pfr-seen { font-size: 11px; color: var(--ok); font-weight: 600; }
.pfr-msg-del { font-size: 11px; color: var(--mut); background: transparent; border: none; cursor: pointer; padding: 0 2px; text-decoration: underline; }
.pfr-msg-del:hover { color: var(--err); }

.pfr-composer-wrap { border-top: 1px solid var(--line); background: var(--card); padding: 10px 14px; display: flex; flex-direction: column; gap: 6px; }
.pfr-composer { display: flex; align-items: flex-end; gap: 8px; }
.pfr-composer textarea { flex: 1; resize: none; max-height: 120px; background: transparent; border: 1px solid var(--line); border-radius: 16px; padding: 8px 12px; font-size: 14px; outline: none; }
.pfr-composer textarea:focus { border-color: var(--mut); }
.pfr-hint { font-size: 12px; color: var(--mut); }

.pfr-back-btn { display: none; }

@media (max-width: 640px) {
  .pfr-layout { flex-direction: column; }
  .pfr-back-btn { display: inline-block; }
  .pfr-container.pfr-show-chat .pfr-sidebar { display: none; }
  .pfr-container.pfr-show-chat .pfr-add-card { display: none; }
  .pfr-container:not(.pfr-show-chat) .pfr-chat-panel { display: none; }
  .pfr-chat-panel { height: 70vh; width: 100%; }
}
  `;
}

export function installFriendsStyles() {
  if (typeof document === 'undefined') return;
  if (!document.getElementById('pfr-styles')) {
    const s = document.createElement('style');
    s.id = 'pfr-styles';
    s.textContent = friendsStyles();
    document.head.append(s);
  }
  try {
    if (typeof installMediaStyles === 'function') installMediaStyles();
  } catch (e) {}
}

export async function mountFriends(host, ctx) {
  installFriendsStyles();
  const { Account, cfg, onUnread, startCall } = ctx || {};
  const S = makeSocial(Account, cfg);
  const me = Account && Account.user && Account.user() ? Account.user().id : '';

  host.textContent = '';
  const root = el('div', 'pfr-wrap pfr-container');
  host.append(root);

  let socialList = [];
  try {
    socialList = await S.list();
  } catch (err) {
    root.textContent = '';
    const card = el('section', 'dcard');
    card.append(el('p', 'dmut', socialFriendly(err)));
    root.append(card);
    return;
  }

  if (onUnread) onUnread(unreadTotal(socialList));

  let activeFriend = null;
  let rowConfirmState = {}; // { [otherId]: 'remove' | 'block' }
  let msgConfirmDelete = {}; // { [msgId]: boolean }
  let pollTimer = null;
  let isPolling = false;

  // Add a friend row
  const addCard = el('section', 'pfr-add-card');
  addCard.append(el('h3', null, 'Add a friend'));
  const addRow = el('div', 'pfr-add-row');
  const addInput = el('input');
  addInput.type = 'text';
  addInput.placeholder = 'Their Platform name';
  const sendReqBtn = btn('Send request', handleSendRequest, 'p');
  addRow.append(addInput, sendReqBtn);
  const addStatus = el('div', 'pfr-status');
  addCard.append(addRow, addStatus);

  async function handleSendRequest() {
    const name = addInput.value.trim();
    if (!name) return;
    sendReqBtn.disabled = true;
    addStatus.textContent = '';
    addStatus.className = 'pfr-status';
    try {
      const res = await S.request(name);
      addInput.value = '';
      addStatus.className = 'pfr-status pfr-ok';
      addStatus.textContent = res === 'accepted' ? 'You are now friends!' : (res === 'already' ? 'Already friends or pending.' : 'Request sent!');
      await refreshList();
    } catch (err) {
      addStatus.className = 'pfr-status pfr-err';
      addStatus.textContent = socialFriendly(err);
    } finally {
      sendReqBtn.disabled = false;
    }
  }

  const layout = el('div', 'pfr-layout');
  const sidebar = el('div', 'pfr-sidebar');
  const chatPanel = el('div', 'pfr-chat-panel');
  layout.append(sidebar, chatPanel);
  root.append(addCard, layout);

  async function refreshList() {
    if (!host.isConnected) return;
    try {
      socialList = await S.list();
      if (onUnread) onUnread(unreadTotal(socialList));
      renderSidebar();
      if (activeFriend) {
        const updated = socialList.find(r => r.other === activeFriend.other);
        if (updated) activeFriend = updated;
      }
    } catch (e) {}
  }

  function renderSidebar() {
    sidebar.textContent = '';

    const requestsForYou = socialList.filter(r => relation(r) === 'received');
    const friends = sortFriends(socialList.filter(r => relation(r) === 'friend'));
    const sentRequests = socialList.filter(r => relation(r) === 'sent');
    const blocked = socialList.filter(r => relation(r) === 'blocked');

    // Section 1: Requests for you
    const secReq = el('section', 'pfr-section');
    secReq.append(el('div', 'pfr-section-title', 'Requests for you'));
    if (requestsForYou.length === 0) {
      secReq.append(el('p', 'pfr-empty', 'No requests'));
    } else {
      for (const row of requestsForYou) {
        const item = el('div', 'pfr-item');
        const info = el('div', 'pfr-item-info');
        info.append(avatarCircle(row.avatar_path, row.name), el('span', 'pfr-name', row.name));
        const acts = el('div', 'pfr-actions');
        const accBtn = btn('Accept', async () => {
          accBtn.disabled = true;
          try { await S.answer(row.friend_id, true); await refreshList(); } catch (e) {}
        }, 'p');
        const decBtn = btn('Decline', async () => {
          decBtn.disabled = true;
          try { await S.answer(row.friend_id, false); await refreshList(); } catch (e) {}
        });
        acts.append(accBtn, decBtn);
        item.append(info, acts);
        secReq.append(item);
      }
    }
    sidebar.append(secReq);

    // Section 2: Friends
    const secFriends = el('section', 'pfr-section');
    secFriends.append(el('div', 'pfr-section-title', 'Friends'));
    if (friends.length === 0) {
      secFriends.append(el('p', 'pfr-empty', 'No friends yet'));
    } else {
      for (const row of friends) {
        const item = el('div', 'pfr-item');
        const info = el('div', 'pfr-item-info');
        const nameEl = el('span', 'pfr-name', row.name);
        if (row.unread > 0) {
          nameEl.append(el('span', 'pfr-badge', String(row.unread)));
        }
        info.append(avatarCircle(row.avatar_path, row.name), nameEl);

        const acts = el('div', 'pfr-actions');
        if (rowConfirmState[row.other]) {
          const mode = rowConfirmState[row.other];
          const box = el('div', 'pfr-confirm-box');
          box.append(el('span', null, mode === 'remove' ? 'Remove?' : 'Block?'));
          const confirmBtn = btn('Confirm', async () => {
            confirmBtn.disabled = true;
            try {
              if (mode === 'remove') await S.remove(row.other);
              else await S.block(row.other);
              delete rowConfirmState[row.other];
              if (activeFriend && activeFriend.other === row.other) closeChat();
              await refreshList();
            } catch (e) {}
          }, 'danger');
          const cancelBtn = btn('Cancel', () => {
            delete rowConfirmState[row.other];
            renderSidebar();
          });
          box.append(confirmBtn, cancelBtn);
          acts.append(box);
        } else {
          const chatBtn = btn('Chat', () => openChat(row), 'p');
          const callBtn = btn('📞 Call', () => startCall && startCall(row));
          callBtn.title = 'Call ' + row.name;
          const remBtn = btn('Remove friend', () => {
            rowConfirmState[row.other] = 'remove';
            renderSidebar();
          });
          const blkBtn = btn('Block', () => {
            rowConfirmState[row.other] = 'block';
            renderSidebar();
          });
          acts.append(chatBtn, callBtn, remBtn, blkBtn);
        }

        item.append(info, acts);
        secFriends.append(item);
      }
    }
    sidebar.append(secFriends);

    // Section 3: Sent requests
    const secSent = el('section', 'pfr-section');
    secSent.append(el('div', 'pfr-section-title', 'Sent requests'));
    if (sentRequests.length === 0) {
      secSent.append(el('p', 'pfr-empty', 'No sent requests'));
    } else {
      for (const row of sentRequests) {
        const item = el('div', 'pfr-item');
        const info = el('div', 'pfr-item-info');
        info.append(avatarCircle(row.avatar_path, row.name), el('span', 'pfr-name', row.name));
        const acts = el('div', 'pfr-actions');
        const cancelBtn = btn('Cancel', async () => {
          cancelBtn.disabled = true;
          try { await S.remove(row.other); await refreshList(); } catch (e) {}
        });
        acts.append(cancelBtn);
        item.append(info, acts);
        secSent.append(item);
      }
    }
    sidebar.append(secSent);

    // Section 4: Blocked
    const secBlocked = el('section', 'pfr-section');
    secBlocked.append(el('div', 'pfr-section-title', 'Blocked'));
    if (blocked.length === 0) {
      secBlocked.append(el('p', 'pfr-empty', 'No blocked users'));
    } else {
      for (const row of blocked) {
        const item = el('div', 'pfr-item');
        const info = el('div', 'pfr-item-info');
        info.append(avatarCircle(row.avatar_path, row.name), el('span', 'pfr-name', row.name));
        const acts = el('div', 'pfr-actions');
        const unblkBtn = btn('Unblock', async () => {
          unblkBtn.disabled = true;
          try { await S.unblock(row.other); await refreshList(); } catch (e) {}
        });
        acts.append(unblkBtn);
        item.append(info, acts);
        secBlocked.append(item);
      }
    }
    sidebar.append(secBlocked);
  }

  // --- Chat View Elements ---
  const chatHeader = el('div', 'pfr-chat-header');
  const chatHeaderTitle = el('h3');
  const backBtn = btn('← Back', closeChat, 'pfr-back-btn');
  chatHeader.append(backBtn, chatHeaderTitle);

  const messagesBody = el('div', 'pfr-chat-body');

  const composerWrap = el('div', 'pfr-composer-wrap');
  const composerRow = el('div', 'pfr-composer');
  const textarea = el('textarea');
  textarea.maxLength = 500;
  textarea.placeholder = 'Write a message...';

  const picker = attachPicker ? attachPicker({ accept: 'both' }) : { node: el('div'), get: () => null, clear: () => {} };
  const sendMsgBtn = btn('Send', handleSendMsg, 'p');
  composerRow.append(textarea, picker.node, sendMsgBtn);

  const hintLine = el('div', 'pfr-hint', 'Links are not allowed. You can send pictures and videos instead.');
  const errorLine = el('div', 'pfr-status pfr-err');
  composerWrap.append(composerRow, hintLine, errorLine);

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMsg();
    }
  });

  async function handleSendMsg() {
    if (!activeFriend) return;
    const text = textarea.value;
    const file = picker && picker.get ? picker.get() : null;
    const bad = dmProblem(text, !!file);
    if (bad) {
      errorLine.textContent = bad;
      return;
    }
    sendMsgBtn.disabled = true;
    errorLine.textContent = '';
    try {
      await S.send(activeFriend.other, text, file);
      textarea.value = '';
      if (picker && picker.clear) picker.clear();
      await loadMessages({ scrollToBottom: true });
      refreshList();
    } catch (err) {
      errorLine.textContent = socialFriendly(err);
    } finally {
      sendMsgBtn.disabled = false;
    }
  }

  function stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function schedulePoll() {
    stopPolling();
    if (!host.isConnected || !activeFriend || document.hidden) return;
    pollTimer = setTimeout(async () => {
      if (!host.isConnected || !activeFriend || document.hidden) {
        stopPolling();
        return;
      }
      if (isPolling) {
        schedulePoll();
        return;
      }
      isPolling = true;
      try {
        await loadMessages({ isPoll: true });
      } catch (e) {
      } finally {
        isPolling = false;
        schedulePoll();
      }
    }, 4000);
  }

  async function loadMessages({ isPoll = false, scrollToBottom = false } = {}) {
    if (!activeFriend || !host.isConnected) return;
    try {
      const msgs = await S.messages(activeFriend.other);
      await S.markRead(activeFriend.other).catch(() => {});

      const wasAtBottom = messagesBody.scrollHeight - messagesBody.scrollTop - messagesBody.clientHeight < 30;

      messagesBody.textContent = '';
      const annotated = chatGroups(msgs, me);

      // Find my last message
      let lastMyMsgId = null;
      for (let i = annotated.length - 1; i >= 0; i--) {
        if (annotated[i].mine) {
          lastMyMsgId = annotated[i].id;
          break;
        }
      }

      let currentDay = '';
      for (const m of annotated) {
        if (m.dayLabel && m.dayLabel !== currentDay) {
          currentDay = m.dayLabel;
          messagesBody.append(el('div', 'pfr-day-label', currentDay));
        }

        const msgWrap = el('div', 'pfr-msg ' + (m.mine ? 'pfr-mine' : 'pfr-theirs'));
        const bub = el('div', 'pfr-bub');

        if (m.body) {
          bub.append(el('div', null, m.body));
        }

        if (m.media_path && typeof lazyMedia === 'function') {
          const mediaNode = lazyMedia(() => S.signedUrl(m.media_path), { video: isVideoPath(m.media_path) });
          bub.append(mediaNode);
        }

        const meta = el('div', 'pfr-msg-meta');
        meta.append(el('span', null, m.showTime));

        if (m.mine) {
          if (msgConfirmDelete[m.id]) {
            const confirmBox = el('span', 'pfr-confirm-box');
            confirmBox.append(el('span', null, 'Delete?'));
            const confBtn = btn('Confirm', async () => {
              confBtn.disabled = true;
              try {
                await S.deleteMessage(m.id);
                delete msgConfirmDelete[m.id];
                await loadMessages({ scrollToBottom: false });
              } catch (e) {
                errorLine.textContent = socialFriendly(e);
              }
            }, 'danger');
            const cancBtn = btn('Cancel', () => {
              delete msgConfirmDelete[m.id];
              loadMessages({ scrollToBottom: false });
            });
            confirmBox.append(confBtn, cancBtn);
            meta.append(confirmBox);
          } else {
            const delBtn = btn('Delete', () => {
              msgConfirmDelete[m.id] = true;
              loadMessages({ scrollToBottom: false });
            }, 'pfr-msg-del');
            meta.append(delBtn);
          }

          if (m.read_at && m.id === lastMyMsgId) {
            meta.append(el('span', 'pfr-seen', 'Seen'));
          }
        }

        msgWrap.append(bub, meta);
        messagesBody.append(msgWrap);
      }

      if (scrollToBottom || !isPoll || wasAtBottom) {
        messagesBody.scrollTop = messagesBody.scrollHeight;
      }
    } catch (err) {
      if (!isPoll) errorLine.textContent = socialFriendly(err);
    }
  }

  async function openChat(friend) {
    activeFriend = friend;
    root.classList.add('pfr-show-chat');
    chatHeaderTitle.textContent = friend.name;
    chatPanel.textContent = '';
    chatPanel.append(chatHeader, messagesBody, composerWrap);
    errorLine.textContent = '';
    textarea.value = '';
    if (picker && picker.clear) picker.clear();
    await loadMessages({ scrollToBottom: true });
    schedulePoll();
  }

  function closeChat() {
    activeFriend = null;
    root.classList.remove('pfr-show-chat');
    stopPolling();
    chatPanel.textContent = '';
    chatPanel.append(el('div', 'pfr-chat-empty', 'Select a friend to start chatting.'));
    refreshList();
  }

  const onVisChange = () => {
    if (document.hidden) {
      stopPolling();
    } else if (activeFriend && host.isConnected) {
      loadMessages({ isPoll: true });
      schedulePoll();
    }
  };
  document.addEventListener('visibilitychange', onVisChange);

  // Initial render
  renderSidebar();
  chatPanel.append(el('div', 'pfr-chat-empty', 'Select a friend to start chatting.'));
}
