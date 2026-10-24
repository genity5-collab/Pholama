// A fake of the weekly-credit tables for tests of functions/pholamaCloud.ts.
// The function reads  GET /rest/v1/pholama_cloud_weekly_usage?...&select=used  and writes  POST /rpc/pholama_cloud_weekly_spend / _weekly_refund.
// Usage:  const W = weeklyFake({ used: 0, cap: 1500 });   inside the fake server:  if (W.handle(u, b, s)) return;
module.exports = function weeklyFake(opts = {}) {
  const st = { cb: { used: opts.cbUsed || 0, cap: opts.cbCap || 15000, spends: [], refunds: [], usageFails: false }, used: opts.used || 0, spends: [], refunds: [], pro: !!opts.pro, usageFails: false, spendFails: false };
  st.extra = opts.extra || 0; st.extraFails = false;   // a per-account allowance (pholama_credit_extra)
  st.cap = () => (st.pro ? (opts.proCap || 1500) : (opts.cap || 1500)) + st.extra;
  st.handle = (u, body, s) => {
    if (u.includes('/rpc/pholama_credit_extra')) { if (st.extraFails) { s.statusCode = 500; s.end('{}'); return true; } s.end(JSON.stringify(st.extra)); return true; }
    if (u.includes('/rpc/pholama_is_pro')) { s.end(JSON.stringify(st.pro)); return true; }
    if (u.includes('/rest/v1/pholama_cloud_weekly_usage')) { if (st.usageFails) { s.statusCode = 500; s.end('{}'); return true; } s.end(JSON.stringify(st.used ? [{ used: st.used }] : [])); return true; }
    // Codebase has its own monthly pool (15,000)
    if (u.includes('/rest/v1/pholama_codebase_monthly_usage')) { if (st.cb.usageFails) { s.statusCode = 500; s.end('{}'); return true; } s.end(JSON.stringify(st.cb.used ? [{ used: st.cb.used }] : [])); return true; }
    if (u.includes('/rpc/pholama_codebase_spend')) {
      const a = JSON.parse(body || '{}'); st.cb.spends.push(a);
      if (st.cb.used + a.p_cost > st.cb.cap + st.extra) { s.end(JSON.stringify([{ ok: false, used: st.cb.used }])); return true; }
      st.cb.used += a.p_cost; s.end(JSON.stringify([{ ok: true, used: st.cb.used }])); return true;
    }
    if (u.includes('/rpc/pholama_codebase_refund')) { const a = JSON.parse(body || '{}'); st.cb.refunds.push(a); st.cb.used = Math.max(0, st.cb.used - a.p_cost); s.end('{}'); return true; }
    if (u.includes('/rpc/pholama_cloud_weekly_spend')) {
      if (st.spendFails) { s.statusCode = 500; s.end('{}'); return true; }
      const a = JSON.parse(body || '{}'); st.spends.push(a);
      if (st.used + a.p_cost > st.cap()) { s.end(JSON.stringify([{ ok: false, used: st.used }])); return true; }
      st.used += a.p_cost; s.end(JSON.stringify([{ ok: true, used: st.used }])); return true;
    }
    if (u.includes('/rpc/pholama_cloud_weekly_refund')) { const a = JSON.parse(body || '{}'); st.refunds.push(a); st.used = Math.max(0, st.used - a.p_cost); s.end('{}'); return true; }
    return false;
  };
  return st;
};
