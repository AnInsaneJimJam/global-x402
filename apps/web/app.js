// Dashboard over the shared control view. No business logic: it renders what the API returns and commits the
// same typed commands the agents use. All values go through textContent (order data contains untrusted text).
const $ = id => document.getElementById(id);
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
const ROUTES = { claim: 'claims', fund_escrow: 'funding', review_evidence: 'evidence-reviews', request_refund: 'refund-requests', authorize_refund: 'refund-authorizations' };
const STATUS = { PAID: ['Paid to filler', 'ok'], REFUNDED: ['Refunded to buyer', 'warn'], DISPUTED: ['Disputed', 'bad'], REFUND_PENDING: ['Refund pending', 'warn'],
  DISPUTE_WINDOW: ['Dispute window', ''], SETTLEMENT_PENDING: ['Paying out', ''], RESULT_PENDING: ['Submitting result', ''] };
let token = '', current = null, listMode = 'work', cache = {};

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(options.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(`${body.error?.code ?? response.status}`), { code: body.error?.code });
  return body;
}
async function guard(fn) { $('error').textContent = ''; try { await fn(); } catch (error) { $('error').textContent = error.message; } }
const fmtTime = iso => iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
const fact = (v, key) => v.facts.find(f => f.key === key);
const tokens = units => `${(Number(units) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 })}`;

async function commit(command, extra = {}) {
  const orderId = current.scope?.id ?? extra.orderId;
  const plan = await api('/v1/action-plans', { method: 'POST', body: JSON.stringify({ command, orderId, ...extra }) });
  const operationId = `ui-${command}-${orderId}-${extra.decision ?? ''}`.slice(0, 128).replace(/[^a-zA-Z0-9_-]/g, '-');
  await api(`/v1/orders/${encodeURIComponent(orderId)}/${ROUTES[command]}`, { method: 'POST', headers: { 'idempotency-key': operationId },
    body: JSON.stringify({ planId: plan.id, operationId }) });
}

function chips(integration) {
  const live = x => x === 'LIVE' || x === 'APP_WORKER_DKIM' || x === 'CRE_DON';
  return [
    [`Cardano Preprod · Masumi escrow · ${integration.payment.execution}`, integration.payment.execution],
    [`${integration.merchant.id} · ${integration.merchant.checkout === 'HUMAN_ASSISTED' ? 'filler checkout' : integration.merchant.checkout} · ${integration.merchant.environment}`, integration.merchant.environment],
    [`proof: ${integration.verifier.execution === 'APP_WORKER_DKIM' ? 'DKIM email' : integration.verifier.execution}`, integration.verifier.execution],
  ].map(([text, value]) => el('span', text, `chip ${live(value) ? 'live' : value === 'MANUAL' ? '' : 'mock'}`));
}

async function loadList() {
  const list = $('orders'); list.replaceChildren();
  const items = listMode === 'open' ? (await api('/v1/orders')).orders : (await api('/v1/work')).items;
  for (const item of items) {
    cache[item.id] = item;
    const li = el('li'); if (current?.scope?.id === item.id) li.classList.add('selected');
    li.append(el('div', item.itemTitle ?? cache[item.id]?.itemTitle ?? item.sku ?? item.id, 't'));
    li.append(el('div', listMode === 'open'
      ? `${(Number(item.fiatMinor) / 100).toFixed(2)} ${item.currency} → ${tokens(item.netTokenUnits)} tUSDM`
      : `${(Number(item.fiatMinor) / 100).toFixed(2)} ${item.currency} · ${STATUS[item.settlement]?.[0] ?? 'In progress'}`, 's'));
    li.addEventListener('click', () => guard(() => show(item.id)));
    if (listMode === 'open' && $('persona').value === 'filler') {
      const claim = el('button', 'Claim', 'primary');
      claim.addEventListener('click', event => { event.stopPropagation(); guard(async () => { await commit('claim', { orderId: item.id }); listMode = 'work'; await refresh(item.id); }); });
      li.append(claim);
    }
    list.append(li);
  }
  if (!items.length) list.append(el('li', listMode === 'open' ? 'No open orders.' : 'No orders yet.', 's'));
}

function timeline(v, details) {
  const f = key => fact(v, key)?.value;
  const purchase = f('merchantPurchase'), evidence = f('evidence'), verification = f('verification'), escrow = f('escrow');
  const settled = v.outcome.settlement, verdict = v.outcome.verification;
  const passed = ['PASS', 'MANUAL_APPROVED'].includes(verdict);
  const steps = [
    ['Buyer posted the order', true, ''],
    ['Filler claimed it', !!v.claimId, details?.nonce ? `order code ${details.nonce}` : ''],
    ['Escrow terms issued by the filler\'s node', !!escrow, escrow ? `result due ${fmtTime(escrow.deadlines.submitResultBy)}` : ''],
    ['Buyer funds locked on Cardano', f('funding') === 'CONFIRMED', f('funding') === 'PENDING' ? 'waiting for confirmation…' : ''],
    ['Filler placed the order with own card', purchase?.state === 'ORDERED', purchase?.merchantOrderId ? `merchant order ${purchase.merchantOrderId}` : ''],
    ['Merchant confirmation email submitted', !!evidence, evidence ? fmtTime(evidence.submittedAt) : ''],
    [passed ? `Placement verified${verdict === 'MANUAL_APPROVED' ? ' (buyer review)' : ' (DKIM)'}` : 'Placement verified', passed,
      verification ? `${verdict} · ${fmtTime(verification.observedAt)}` : '', ['FAIL', 'MANUAL_REJECTED'].includes(verdict)],
    ['Result submitted to escrow', ['RESULT_PENDING', 'DISPUTE_WINDOW', 'SETTLEMENT_PENDING', 'PAID'].includes(settled), ''],
    ['Dispute window', ['SETTLEMENT_PENDING', 'PAID'].includes(settled), escrow ? `unlocks ${fmtTime(escrow.deadlines.unlockAt)}` : ''],
    [settled === 'REFUNDED' ? 'Refunded to buyer' : 'Paid out to filler', ['PAID', 'REFUNDED'].includes(settled), ''],
  ];
  const ol = $('timeline'); ol.replaceChildren();
  let nowMarked = false;
  for (const [label, done, when, failed] of steps) {
    const li = el('li', label, done ? 'done' : failed ? 'fail' : !nowMarked ? 'now' : '');
    if (!done && !failed) nowMarked = true;
    if (when) li.append(el('span', when, 'when'));
    ol.append(li);
  }
}

function dl(id, rows) { const d = $(id); d.replaceChildren(); for (const [k, val] of rows) { d.append(el('dt', k)); d.append(el('dd', val)); } }

async function show(orderId) {
  const v = await api(`/v1/orders/${encodeURIComponent(orderId)}/control`);
  current = v;
  const details = await api(`/v1/orders/${encodeURIComponent(orderId)}/assignment`).catch(() => null);
  const listed = cache[orderId];
  $('empty').hidden = true; $('detail').hidden = false;
  $('orderId').textContent = `Order ${v.scope.id}`;
  $('title').textContent = details?.itemTitle ?? listed?.itemTitle ?? 'Order';
  $('summary').textContent = v.summary;
  $('labels').replaceChildren(...chips(v.integration));
  const [statusText, statusClass] = STATUS[v.outcome.settlement] ?? [v.outcome.verification === 'PENDING' ? 'Verifying proof' :
    fact(v, 'funding')?.value === 'CONFIRMED' ? 'Funded · awaiting order' : v.claimId ? 'Claimed · awaiting funding' : 'Open', ''];
  $('status').replaceChildren(el('span', statusText, statusClass));
  timeline(v, details);
  const escrow = fact(v, 'escrow')?.value;
  const fiatMinor = details?.maximumChargeMinor ?? listed?.fiatMinor, currency = details?.currency ?? listed?.currency;
  const units = escrow?.grossBaseUnits ?? listed?.netTokenUnits;
  dl('economics', [
    ['Filler pays (fiat, own card)', fiatMinor ? `${(Number(fiatMinor) / 100).toFixed(2)} ${currency}` : '—'],
    ['Filler receives', units ? `${tokens(units)} tUSDM` : '—'],
    ['Effective rate', fiatMinor && units ? `${((Number(fiatMinor) / 100) / (Number(units) / 1e6)).toFixed(2)} ${currency} per tUSDM` : '—'],
    ['Protocol fee (Masumi V2)', '0 · network fees in tADA'],
  ]);
  dl('escrow', escrow ? [['On-chain state', escrow.nativeState], ['Pay by', fmtTime(escrow.deadlines.payBy)],
    ['Result due', fmtTime(escrow.deadlines.submitResultBy)], ['Unlocks', fmtTime(escrow.deadlines.unlockAt)]] : [['Escrow', 'not issued yet']]);
  const txs = $('txs'); txs.replaceChildren();
  for (const tx of escrow?.txs ?? []) {
    const li = el('li', `${tx.kind} · ${tx.status} · `);
    if (/^[0-9a-f]{64}$/.test(tx.txHash)) {
      const a = el('a', `${tx.txHash.slice(0, 12)}…`); a.href = `https://preprod.cardanoscan.io/transaction/${tx.txHash}`; a.target = '_blank'; a.rel = 'noopener';
      li.append(a);
    } else li.append(el('span', tx.txHash, 'muted'));
    txs.append(li);
  }
  const verification = fact(v, 'verification')?.value;
  $('proofSource').textContent = verification ? `· ${verification.execution === 'MANUAL' ? 'buyer manual review' : 'merchant DKIM signature'}` : '';
  const t = $('criteria'); t.replaceChildren();
  const head = t.createTHead().insertRow(); for (const h of ['Check', 'Expected', 'Seen in merchant email', 'Result']) head.append(el('th', h));
  for (const c of verification?.criteria ?? []) {
    const row = t.insertRow();
    const money = text => c.id === 'TOTAL' && /^[A-Z]{3} \d+$/.test(text ?? '') ? `${text.slice(0, 3)} ${(Number(text.slice(4)) / 100).toFixed(2)}` : text;
    for (const [value, cls] of [[c.id.replaceAll('_', ' ').toLowerCase()], [money(c.expected)], [money(c.observed) ?? '—'], [c.result, c.result]]) {
      const td = row.insertCell(); td.textContent = value; if (cls) td.className = cls;
    }
  }
  if (!verification) { const row = t.insertRow(); const td = row.insertCell(); td.colSpan = 4; td.textContent = 'No confirmation email verified yet.'; td.className = 'muted'; }
  renderActions(v);
  if (listMode === 'work') await loadList();
}

function renderActions(v) {
  const box = $('actions'); box.replaceChildren();
  const available = new Set(v.actions.filter(a => a.status === 'AVAILABLE').map(a => a.command));
  const add = (label, cls, fn) => { const b = el('button', label, cls); b.addEventListener('click', () => guard(async () => { await fn(); await show(v.scope.id); })); box.append(b); };
  if (available.has('fund_escrow')) add('Fund escrow', 'primary', () => commit('fund_escrow'));
  if (available.has('review_evidence')) { add('Approve evidence', 'primary', () => commit('review_evidence', { decision: 'APPROVE' }));
    add('Reject evidence', 'danger', () => commit('review_evidence', { decision: 'REJECT' })); }
  if (available.has('request_refund')) add('Request refund', 'danger', () => commit('request_refund'));
  if (available.has('authorize_refund')) add('Authorize refund', '', () => commit('authorize_refund'));
  if (!box.children.length) box.append(el('span', 'Nothing to do right now — agents and the escrow are handling it.', 'muted'));
  $('obligations').textContent = v.obligations.length ? `Waiting on: ${v.obligations.map(o => o.type.replaceAll('_', ' ').toLowerCase()).join(', ')}` : '';
}

async function refresh(orderId) { await loadList(); if (orderId ?? current?.scope?.id) await show(orderId ?? current.scope.id); }
$('connect').addEventListener('click', () => guard(async () => { token = $('token').value.trim(); current = null; $('detail').hidden = true; $('empty').hidden = false;
  const cap = await api('/v1/capabilities'); $('labels').replaceChildren(...chips(cap.integration)); await loadList(); }));
$('open').addEventListener('click', () => guard(async () => { listMode = 'open'; $('open').classList.add('active'); $('work').classList.remove('active'); await loadList(); }));
$('work').addEventListener('click', () => guard(async () => { listMode = 'work'; $('work').classList.add('active'); $('open').classList.remove('active'); await loadList(); }));
setInterval(() => { if (token && current) refresh().catch(() => {}); }, 4000);
// Recording/preview convenience: #token=…&persona=buyer|filler&order=…&list=open. The fragment never leaves the browser.
const hash = new URLSearchParams(location.hash.slice(1));
if (hash.get('token')) guard(async () => {
  $('token').value = hash.get('token'); if (hash.get('persona')) $('persona').value = hash.get('persona');
  token = hash.get('token');
  const cap = await api('/v1/capabilities'); $('labels').replaceChildren(...chips(cap.integration));
  if (hash.get('list') === 'open') { listMode = 'open'; $('open').classList.add('active'); $('work').classList.remove('active'); }
  await loadList();
  if (hash.get('order')) await show(hash.get('order'));
});
