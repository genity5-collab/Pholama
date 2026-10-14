// Pholama cloud agents. The Free.ai key stays here, never in the browser. Only Free.ai's free self-hosted models are called.
// Secrets: FREE_AI_API_KEY, PHOLAMA_SUPABASE_SERVICE_KEY. Only Free.ai's free self-hosted models are ever called.
import { CONFIGS, getConfig, findAgent, pickAgents, autoPick, chooseSubagents, subagentCost, agentName, systemPrompt, cleanName, available, isSelfHosted, MAX_PICKED, SUBAGENT_LIMIT, randomName } from './agentsCore.ts';
import { runSubagent, pollJob } from './agentsRun.ts';

const SB = 'https://nyswblzzvqzheaxvrqtq.supabase.co';
const FREE_AI = 'https://api.free.ai/v1';
const CHAT_COST = 1;           // one chat message, any config
const MAX_TEXT = 6000;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Content-Type': 'application/json' };
const out = (data: unknown, status = 200) => new Response(JSON.stringify(status >= 400 ? { error: String(data) } : data), { status, headers: cors });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return out('Method not allowed.', 405);
  const service = Deno.env.get('PHOLAMA_SUPABASE_SERVICE_KEY') || '', aiKey = Deno.env.get('FREE_AI_API_KEY') || '';
  if (!service) return out('Pholama agents are not configured yet.', 503);
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return out('Log in to use Pholama agents.', 401);
  const who = await fetch(SB + '/auth/v1/user', { headers: { apikey: service, Authorization: 'Bearer ' + token } });
  if (!who.ok) return out('Your login expired. Log in again.', 401);
  const user = await who.json(); if (!user?.id) return out('Log in to use Pholama agents.', 401);
  const uid = String(user.id), body = await req.json().catch(() => ({})), action = String(body.action || '');
  const H = { apikey: service, Authorization: 'Bearer ' + service, 'Content-Type': 'application/json' };
  const rest = async (path: string, init: RequestInit = {}) => { const r = await fetch(SB + '/rest/v1/' + path, { ...init, headers: { ...H, ...(init.headers || {}) } }); const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* empty */ } if (!r.ok) throw new Error('database ' + r.status); return j; };
  const rpc = async (fn: string, b: unknown) => { const r = await fetch(SB + '/rest/v1/rpc/' + fn, { method: 'POST', headers: H, body: JSON.stringify(b) }); const j = await r.json().catch(() => null); if (!r.ok) throw new Error('database ' + r.status); return j; };

  const profile = async () => {
    const rows = await rest('pholama_agent_profile?select=*&user_id=eq.' + uid + '&limit=1');
    const p = rows?.[0] || { agent_name: null, config: 'one', picked: ['chat'], subagents: true };
    const pk = pickAgents(p.config, p.picked);
    return { chosen: p.agent_name as string | null, name: agentName({ chosen: p.agent_name }, uid), config: pk.config, picked: pk.picked, subagents: p.subagents !== false };
  };
  const saveProfile = (patch: Record<string, unknown>) => rest('pholama_agent_profile?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: uid, ...patch, updated_at: new Date().toISOString() }) });
  const balance = async () => { const r = await rpc('pholama_credits_spend', { p_user: uid, p_cost: 0 }); return { credits: Number(r?.balance ?? 0), refill_on: r?.refill_on || null }; };

  const free = async (path: string, payload: unknown) => {
    const r = await fetch(FREE_AI + path, { method: 'POST', headers: { Authorization: 'Bearer ' + aiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(125000) });
    const j: any = await r.json().catch(() => ({})); return { ok: r.ok, status: r.status, j };
  };

  try {
    if (action === 'state') {
      const p = await profile(), b = await balance();
      return out({ name: p.name, chosenName: p.chosen, config: p.config, picked: p.picked, subagents: p.subagents, credits: b.credits, refill_on: b.refill_on, maxPicked: MAX_PICKED, subagentLimit: SUBAGENT_LIMIT,
        configs: Object.values(CONFIGS).map(c => ({ id: c.id, label: c.label, agents: c.agents.map(a => ({ role: a.role, label: a.label, asked: a.asked, model: a.model, available: available(a), cost: a.cost, note: a.note || '' })) })) });
    }
    if (action === 'name') {   // empty = go back to the random name
      const v = String(body.name == null ? '' : body.name).trim();
      if (!v) { await saveProfile({ agent_name: null }); return out({ name: randomName(uid), chosenName: null }); }
      const n = cleanName(v); await saveProfile({ agent_name: n }); return out({ name: n, chosenName: n });
    }
    if (action === 'configure') {
      const pk = body.auto === false ? { ...pickAgents(body.config, body.picked), auto: [] as string[] } : autoPick(body.config, body.picked);
      await saveProfile({ config: pk.config, picked: pk.picked, subagents: body.subagents !== false });
      return out({ config: pk.config, picked: pk.picked, auto: pk.auto, subagents: body.subagents !== false });
    }

    if (action === 'run') {   // one file-based subagent: OCR, vision, depth, speech, 3D, image edit, voice, translation, music
      if (!aiKey) return out('The cloud agents are not configured yet.', 503);
      const p = await profile(); if (!p.subagents || body.subagents === false) return out('Subagents are switched off. Turn them on to use this.', 400);
      const role = String(body.role || ''), a = findAgent(p.config, role);
      if (!a) return out('This configuration has no such agent.', 400);
      if (!available(a)) return out(a.note || 'This agent is unavailable.', 400);
      if (role !== 'chat' && !p.picked.includes(role) && !(a.cost <= 3)) return out('Turn on the ' + a.label + ' first (it costs ' + a.cost + ' credits).', 400);
      const cost = Math.max(1, a.cost), spent = await rpc('pholama_credits_spend', { p_user: uid, p_cost: cost });
      if (!spent?.ok) return out({ error: 'You need ' + cost + ' credits (' + (spent?.balance ?? 0) + ' left).' + (spent?.refill_on ? ' They refill on ' + spent.refill_on + '.' : ''), code: 'credits', credits: spent?.balance ?? 0 }, 402);
      const res = await runSubagent(aiKey, { role, config: p.config, text: String(body.text || '').slice(0, 2000), fileBase64: typeof body.file === 'string' ? body.file : undefined, mime: String(body.mime || ''), lang: String(body.lang || 'en') });
      if (!res.ok) { await rpc('pholama_credits_refund', { p_user: uid, p_amount: cost }).catch(() => {}); return out({ ...res, charged: 0, credits: Number(spent.balance ?? 0) + cost }); }
      return out({ ...res, charged: cost, credits: Number(spent.balance ?? 0) });
    }
    if (action === 'poll') return out(await pollJob(aiKey, String(body.jobId || '')));

    if (action === 'continue') {
      if (!aiKey) return out('The cloud agent is not configured yet.', 503);
      const p = await profile(), chat = findAgent(p.config, 'chat')!;
      if (!isSelfHosted(chat.model)) return out('Only Free.ai\'s free models are allowed.', 400);
      const history = (Array.isArray(body.history) ? body.history : []).slice(-8).map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 2000) }));
      if (!history.length || history[history.length - 1].role !== 'assistant') return out('There is no assistant reply to continue.', 400);
      const cost = 2, spent = await rpc('pholama_credits_spend', { p_user: uid, p_cost: cost });
      if (!spent?.ok) return out({ error: 'You need 2 credits to continue (' + (spent?.balance ?? 0) + ' left).' + (spent?.refill_on ? ' They refill on ' + spent.refill_on + '.' : ''), code: 'credits', credits: spent?.balance ?? 0, refill_on: spent?.refill_on || null }, 402);
      const startedAt = Date.now();
      let r;
      try {
        r = await free('/chat/', { model: chat.model, messages: [{ role: 'system', content: systemPrompt(p.name, p.config, p.picked) }, ...history, { role: 'user', content: 'Continue the previous answer from exactly where it stopped. Do not repeat earlier text. If the answer is complete, say so briefly.' }], max_tokens: 1400 });
      } catch {
        await rpc('pholama_credits_refund', { p_user: uid, p_amount: cost }).catch(() => {});
        return out('The cloud agent did not answer. You were not charged. Try again.', 502);
      }
      const reply = String(r.j?.choices?.[0]?.message?.content || '').trim();
      if (!r.ok || !reply) {
        await rpc('pholama_credits_refund', { p_user: uid, p_amount: cost }).catch(() => {});
        return out('The cloud agent did not answer. You were not charged. Try again.', 502);
      }
      const finishReason = String(r.j?.choices?.[0]?.finish_reason || '');
      return out({ reply, agent: p.name, model: chat.model, charged: cost, credits: Number(spent.balance ?? 0), refill_on: spent.refill_on || null, canContinue: finishReason === 'length' || Date.now() - startedAt >= 120000 });
    }

    if (action === 'chat') {
      if (!aiKey) return out('The cloud agent is not configured yet.', 503);
      const text = String(body.text || '').trim(); if (!text) return out('Write a message first.', 400); if (text.length > MAX_TEXT) return out('That message is too long (max ' + MAX_TEXT + ' characters).', 400);
      const p = await profile(), plan = chooseSubagents(text, p.config, { subagents: p.subagents && body.subagents !== false, allow: p.picked.filter(r => r !== 'chat') });
      const subCost = subagentCost(plan.use), total = CHAT_COST + subCost;
      const spent = await rpc('pholama_credits_spend', { p_user: uid, p_cost: total });
      if (!spent?.ok) {
        return out({ error: 'You do not have enough credits (' + total + ' needed, ' + (spent?.balance ?? 0) + ' left).' + (spent?.refill_on ? ' They refill on ' + spent.refill_on + '.' : ''), code: 'credits', credits: spent?.balance ?? 0, refill_on: spent?.refill_on || null }, 402);
      }
      const chat = findAgent(p.config, 'chat')!; if (!isSelfHosted(chat.model)) return out('Only Free.ai\'s free models are allowed.', 400);
      const history = (Array.isArray(body.history) ? body.history : []).slice(-8).map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 2000) }));
      // This is an in-app mock workspace, not a connection to Roblox Studio or the separate RetroStudio service.
      const pluginPrompt = body.plugin === 'retrostudio' ? '\n\nRoblox: RetroStudio plugin is enabled. Help create and edit a Luau script for the Pholama in-app mock Studio. For previewable scenes, use only this static subset: one `local name = Instance.new("Part")` per line; simple `name.Name = "..."`, `name.Size = Vector3.new(x,y,z)`, `name.Position = Vector3.new(x,y,z)`, `name.CFrame = CFrame.new(x,y,z)`, `name.Color = Color3.fromRGB(r,g,b)`, `name.Material = Enum.Material.<Plastic|SmoothPlastic|Wood|Concrete|Metal|Glass|Neon|Brick|Grass|Fabric>`, `name.Anchored = true|false`, `name.CanCollide = true|false`, and `name.Parent = workspace`. Keep statements one per line. Explain unsupported Luau plainly. The preview only statically simulates those properties; it never executes Lua, controls official Roblox/RetroStudio, encodes scripts, or performs a real Roblox playtest. Never claim otherwise. Return the complete script in a fenced ```lua block and summarize what the mock can show.' : '';
      // A subagent is only reported as used if Free.ai really answered it. Nothing here is invented.
      const used: { role: string; label: string; model: string | null; ok: boolean; note: string }[] = [];
      for (const s of plan.use) {
        let note = '', ok = false;
        if (s.type === 'translation') { const r = await free('/chat/', { model: 'mistral', messages: [{ role: 'system', content: 'You translate text. Reply with only the translation.' }, { role: 'user', content: text }], max_tokens: 500 }).catch(() => ({ ok: false, j: {} })); ok = r.ok; note = ok ? String(r.j?.choices?.[0]?.message?.content || '').slice(0, 800) : 'The translation agent did not answer.'; }
        else { note = 'Needs a file or an extra step, so this subagent was not run from text alone. Use the agent panel to send it a file.'; }
        used.push({ role: s.role, label: s.label, model: s.model, ok, note });
      }
      const ran = used.filter(u => u.ok), ctx = ran.length ? '\n\nSubagent results (real):\n' + ran.map(u => '- ' + u.label + ': ' + u.note).join('\n') : '';
      const startedAt = Date.now();
      let r;
      try { r = await free('/chat/', { model: chat.model, messages: [{ role: 'system', content: systemPrompt(p.name, p.config, p.picked) + pluginPrompt + ctx }, ...history, { role: 'user', content: text }], max_tokens: 1400 }); }
      catch {
        await rpc('pholama_credits_refund', { p_user: uid, p_amount: total }).catch(() => {});
        return out('The cloud agent did not answer. You were not charged. Try again.', 502);
      }
      const reply = String(r.j?.choices?.[0]?.message?.content || '').trim();
      if (!r.ok || !reply) {   // charge nothing for an answer that never came
        await rpc('pholama_credits_refund', { p_user: uid, p_amount: total }).catch(() => {});
        return out('The cloud agent did not answer. You were not charged. Try again.', 502);
      }
      const left = Number(spent.balance ?? 0);
      const finishReason = String(r.j?.choices?.[0]?.finish_reason || '');
      return out({ reply, agent: p.name, model: chat.model, asked: chat.asked, charged: total, credits: left, refill_on: spent.refill_on || null, subagents: used, skipped: plan.skipped, subagentsOff: plan.disabled, canContinue: finishReason === 'length' || Date.now() - startedAt >= 120000 });
    }
    return out('Unknown action.', 400);
  } catch (e) {
    const m = e instanceof Error ? e.message : '';
    return out(/^(Pick a name|A name can|That name)/.test(m) ? m : 'Something went wrong. Try again.', /^(Pick a name|A name can|That name)/.test(m) ? 400 : 500);
  }
});
