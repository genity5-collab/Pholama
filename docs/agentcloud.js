// Website agent client. The Free.ai key stays in the deployed function; this module only sends the member's login token.
export const AGENT_URL = 'https://lyra-09dfabbf.base44.app/functions/pholamaAgents';

export async function agentRequest(action, payload = {}, token, fetchImpl = fetch, signal) {
  if (!token) { const e = new Error('Log in to use the cloud assistant.'); e.code = 'login'; throw e; }
  let response;
  try {
    response = await fetchImpl(AGENT_URL, {
      method: 'POST', signal,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload })
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    const err = new Error('Could not reach the cloud assistant. Check your connection.'); err.code = 'network'; throw err;
  }
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const err = new Error(typeof data.error === 'string' ? data.error : 'The cloud assistant could not answer.');
    err.code = data.code || 'server'; err.info = data; throw err;
  }
  return data;
}

export async function fileToBase64(file) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('The attached image could not be read.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const stride = 0x8000;
  for (let i = 0; i < bytes.length; i += stride) binary += String.fromCharCode(...bytes.subarray(i, i + stride));
  return btoa(binary);
}
