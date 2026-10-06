// Settings > Plans: Free vs Pholama Pro, and how to get Pro (a Roblox subscription + a one-time code).
// Shared by the website (docs/) and the PC app (web/): the two copies must stay identical (the tests check it).
// The database decides who is Pro; this page only SHOWS the plan and asks for a code. It cannot grant anything.

export const FREE = { max_day: 10, max_month: 30, projects: 5, friends: 5, max_dms: 5, memories_web: 5, memories_pc: 15, integration_tokens: 5000 };
export const PRO = { max_day: 15, max_month: 35, projects: 10, friends: 10, max_dms: 10, memories_web: 15, memories_pc: 45, integration_tokens: 10000 };
export const CODE_MINUTES = 30;

// What each plan gives, in one list so the table and the tests cannot drift apart.
export function rows() {
  return [
    ['Agent Max messages a day', FREE.max_day, PRO.max_day],
    ['Agent Max messages a month', FREE.max_month, PRO.max_month],
    ['Projects you can share', FREE.projects, PRO.projects],
    ['Friends', FREE.friends, PRO.friends],
    ['Daily messages to Agent Max as a friend', FREE.max_dms, PRO.max_dms],
    ['Saved memories (website)', FREE.memories_web, PRO.memories_web],
    ['Saved memories (PC app)', FREE.memories_pc, PRO.memories_pc],
    ['Integration tokens', FREE.integration_tokens.toLocaleString('en-US'), PRO.integration_tokens.toLocaleString('en-US')],
  ];
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function daysLeft(until, now = Date.now()) {
  const t = Date.parse(until); if (!Number.isFinite(t) || t <= now) return 0;
  return Math.ceil((t - now) / 864e5);
}

// A short message for a code that has run out, counting down while it is open.
export function codeClock(expiresAt, now = Date.now()) {
  const left = Math.max(0, Math.floor((expiresAt - now) / 1000));
  if (left <= 0) return { expired: true, text: 'This code has expired. Make a new one.' };
  const m = Math.floor(left / 60), s = left % 60;
  return { expired: false, text: 'Use it in the game within ' + m + ':' + String(s).padStart(2, '0') };
}

export function html(plan, gameUrl) {
  const pro = !!(plan && (plan.pro === true || plan.is_pro === true || plan.plan === 'pro'));
  const until = plan && (plan.until || plan.expires_at || plan.expiresAt || plan.renewed_until);
  const status = pro ? '<span class="pl-badge pro">PRO ACTIVE</span>' : '<span class="pl-badge free">FREE PLAN</span>';
  const table = rows().map(r => '<tr><td>' + esc(r[0]) + '</td><td class="pl-f">' + esc(r[1]) + '</td><td class="pl-p">' + esc(r[2]) + '</td></tr>').join('');
  const head = pro
    ? '<p class="pl-now">' + status + ' <b>You are on Pholama Pro.</b> ' + daysLeft(until) + ' day' + (daysLeft(until) === 1 ? '' : 's') + ' left. It renews while your Roblox subscription is active.</p>'
    : '<p class="pl-now">' + status + ' <b>You are on the Free plan.</b> Pholama Pro gives you more of everything below.</p>';
  const how = '<ol class="pl-how"><li>Tap <b>Get my code</b> below.</li><li>Open the Pholama game on Roblox and subscribe to Pholama Pro (100 Robux a month).</li><li>Type the code into the box in the game. It only works for ' + CODE_MINUTES + ' minutes and only once.</li></ol>';
  const link = gameUrl ? '<p><a href="' + esc(gameUrl) + '" target="_blank" rel="noopener">Open the game on Roblox</a></p>' : '';
  return head + '<table class="pl-tbl"><thead><tr><th></th><th>Free</th><th>Pro</th></tr></thead><tbody>' + table + '</tbody></table>'
    + how + link
    + '<p><button class="p" id="pl_get">' + (pro ? 'Get a code to renew' : 'Get my code') + '</button></p>'
    + '<div id="pl_code" style="display:none"><div class="pl-codebox" id="pl_codebox"></div><div class="sys" id="pl_clock"></div></div>'
    + '<div class="sys" id="pl_msg" style="min-height:1.2em"></div>';
}

// Mounts the tab. `Account` is the shared sign-in helper; `cfg` is window.PHOLAMA.
export async function mount(host, { Account, cfg = {}, now = () => Date.now(), setInterval: si = setInterval, clearInterval: ci = clearInterval } = {}) {
  let timer = null, expires = 0;
  const stop = () => { if (timer) { ci(timer); timer = null; } };
  const q = s => host.querySelector(s);
  async function readPlan() { try { return await Account.rest('rpc/pholama_my_plan', { method: 'POST', body: '{}' }); } catch { return null; } }
  async function paint() {
    stop();
    if (!Account.user()) { host.innerHTML = '<p class="sys">Log in to see your plan and get Pro.</p>'; return 'login'; }
    const plan = await readPlan();
    host.innerHTML = html(plan, cfg.PRO_GAME_URL);
    q('#pl_get').onclick = getCode;
    return plan && plan.pro ? 'pro' : 'free';
  }
  async function getCode() {
    const btn = q('#pl_get'), msg = q('#pl_msg'); btn.disabled = true; msg.textContent = '';
    try {
      const c = await Account.rest('rpc/pholama_pro_code_new', { method: 'POST', body: '{}' });
      if (typeof c !== 'string' || !/^[0-9A-F]{8}$/.test(c)) throw new Error('Could not make a code. Try again.');
      expires = now() + CODE_MINUTES * 60000;
      q('#pl_code').style.display = ''; q('#pl_codebox').textContent = c;
      const tick = () => { const k = codeClock(expires, now()); q('#pl_clock').textContent = k.text; if (k.expired) { stop(); q('#pl_codebox').textContent = '--------'; btn.disabled = false; btn.textContent = 'Make a new code'; } };
      tick(); timer = si(tick, 1000);
      btn.disabled = true;   // one live code at a time: a new one would cancel the one being typed into the game
    } catch (e) { msg.textContent = e.message || 'Could not make a code.'; btn.disabled = false; }
  }
  return { paint, stop };
}
