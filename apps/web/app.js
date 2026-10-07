// Minimal dashboard: renders the same control view agents use. No business logic here; every value is
// inserted with textContent (never innerHTML) because order data includes untrusted merchant/filler text.
const $ = id => document.getElementById(id);
let current = null;

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { authorization: `Bearer ${$('token').value}`,
    'content-type': 'application/json', ...(options.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${body.error?.code ?? 'ERROR'}`);
  return body;
}
function cell(row, value, className) {
  const td = row.insertCell();
  td.textContent = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  if (className) td.className = className;
}
function table(id, headings, rows) {
  const t = $(id); t.replaceChildren();
  const head = t.createTHead().insertRow();
  for (const h of headings) { const th = document.createElement('th'); th.textContent = h; head.append(th); }
  for (const r of rows) { const row = t.insertRow(); r.forEach(([value, cls]) => cell(row, value, cls)); }
}
async function guard(fn) {
  $('error').textContent = '';
  try { await fn(); } catch (error) { $('error').textContent = String(error.message ?? error); }
}
function listOrders(ids, label) {
  const list = $('orders'); list.replaceChildren();
  for (const item of ids) {
    const li = document.createElement('li');
    li.textContent = label(item);
    const open = document.createElement('button');
    open.textContent = 'Open';
    open.addEventListener('click', () => guard(() => show(typeof item === 'string' ? item : item.id)));
    li.append(open); list.append(li);
  }
  if (!ids.length) list.textContent = 'None.';
}
async function show(orderId) {
  const v = await api(`/v1/orders/${encodeURIComponent(orderId)}/control`);
  current = v;
  $('detail').hidden = false;
  $('orderId').textContent = v.scope.id;
  const i = v.integration;
  $('labels').replaceChildren(...[
    `payment ${i.payment.protocol} ${i.payment.network} ${i.payment.execution}`,
    `merchant ${i.merchant.id} ${i.merchant.environment} ${i.merchant.checkout}`,
    `verifier ${i.verifier.execution}`,
  ].map(text => Object.assign(document.createElement('span'), { textContent: text })));
  $('summary').textContent = v.summary;
  table('outcome', ['placement', 'verification', 'settlement'],
    [[[v.outcome.placement], [v.outcome.verification, v.outcome.verification], [v.outcome.settlement]]]);
  const verification = v.facts.find(f => f.key === 'verification')?.value;
  table('criteria', ['criterion', 'expected', 'observed', 'result'],
    (verification?.criteria ?? []).map(c => [[c.id], [c.expected], [c.observed ?? '—'], [c.result, c.result]]));
  table('facts', ['key', 'state', 'source', 'value'],
    v.facts.filter(f => f.key !== 'verification').map(f => [[f.key], [f.state, f.state], [f.sourceType], [f.value]]));
  table('obligations', ['type', 'owner'], v.obligations.map(o => [[o.type], [o.owner ?? '—']]));
  table('actions', ['command', 'status', 'reasons'], v.actions.map(a => [[a.command], [a.status, a.status], [a.reasonCodes.join(', ')]]));
  $('review').hidden = v.actions.find(a => a.command === 'review_evidence')?.status !== 'AVAILABLE';
}
async function review(decision) {
  const orderId = current.scope.id;
  const plan = await api('/v1/action-plans', { method: 'POST', body: JSON.stringify({ command: 'review_evidence', orderId, decision }) });
  const operationId = `review-${orderId}-${decision}`.slice(0, 128);
  await api(`/v1/orders/${encodeURIComponent(orderId)}/evidence-reviews`, { method: 'POST',
    headers: { 'idempotency-key': operationId }, body: JSON.stringify({ planId: plan.id, operationId }) });
  await show(orderId);
}
$('open').addEventListener('click', () => guard(async () => listOrders((await api('/v1/orders')).orders,
  o => `${o.id} — ${o.itemTitle ?? o.sku} × ${o.quantity}, ${o.fiatMinor} ${o.currency} minor → ${o.netTokenUnits} token units`)));
$('work').addEventListener('click', () => guard(async () => listOrders((await api('/v1/work')).orders, id => id)));
$('approve').addEventListener('click', () => guard(() => review('APPROVE')));
$('reject').addEventListener('click', () => guard(() => review('REJECT')));
