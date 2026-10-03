// Remote PC access helper module
export function remoteBase() {
  try {
    const url = localStorage.getItem('pholama.remote.url') || '';
    return url.trim().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function remoteHeaders() {
  try {
    const key = (localStorage.getItem('pholama.remote.key') || '').trim();
    return key ? { Authorization: 'Bearer ' + key } : {};
  } catch {
    return {};
  }
}

export async function remoteTest() {
  const base = remoteBase();
  if (!base) return { ok: false, msg: 'No PC address entered' };
  try {
    const r1 = await fetch(base + '/api/auth');
    if (!r1.ok) return { ok: false, msg: 'Could not reach host (' + r1.status + ')' };
  } catch (e) {
    return { ok: false, msg: 'Could not reach host at ' + base };
  }

  try {
    const r2 = await fetch(base + '/api/credits', { headers: remoteHeaders() });
    if (r2.status === 401) return { ok: false, msg: 'Key rejected' };
    if (!r2.ok) return { ok: false, msg: 'Server error (' + r2.status + ')' };
    return { ok: true, msg: 'Connected successfully' };
  } catch (e) {
    return { ok: false, msg: 'Connection failed' };
  }
}
