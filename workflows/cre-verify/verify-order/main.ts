// Chainlink CRE workflow: verifies a filler's order-confirmation email (DKIM + order checks) on CRE nodes.
// Trigger: HTTP payload { orderId, sha256 }. Each node fetches the evidence and expected terms from the coordinator,
// fetches the merchant's DKIM key over DNS-over-HTTPS, and runs the shared dependency-free verifier. Nodes must reach
// identical consensus on the verdict, which is then posted back to the coordinator (recorded as CRE_SIMULATION here).
import { consensusIdenticalAggregation, decodeJson, handler, HTTPCapability, HTTPClient, Runner,
  type HTTPPayload, type HTTPSendRequester, type Runtime } from "@chainlink/cre-sdk";
import { dkimKeysNeeded, fromBase64, keyId, toBase64, verifyOrderEmailWithKeys } from "../../../packages/verification/pure";
import { amazonIn } from "../../../packages/merchants/amazon-in";

export type Config = { apiUrl: string; dohUrl: string };
type Input = { orderId: string; sha256: string };
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const DNS_NAME = /^(?=.{1,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const MERCHANTS = { "amazon-in": amazonIn } as const;

// Runs on every node; returns the verdict as a canonical JSON string so nodes can agree on it exactly.
const verifyOnNode = (http: HTTPSendRequester, config: Config, input: Input, token: string, nowIso: string): string => {
  const res = http.sendRequest({ url: `${config.apiUrl}/v1/internal/cre/evidence/${input.orderId}?sha256=${input.sha256}`,
    method: "GET", headers: { "x-cre-token": token } }).result();
  if (res.statusCode !== 200) throw new Error(`evidence fetch failed: HTTP ${res.statusCode}`);
  const evidence = JSON.parse(text(res.body)) as { merchantId: keyof typeof MERCHANTS; emlBase64: string; expected: Parameters<typeof verifyOrderEmailWithKeys>[0]["expected"] };
  const merchant = MERCHANTS[evidence.merchantId];
  if (!merchant) throw new Error(`merchant not supported: ${evidence.merchantId}`);
  const raw = fromBase64(evidence.emlBase64);
  const keys: Record<string, string | null> = {};
  for (const k of dkimKeysNeeded(raw, merchant.dkimDomains)) {
    const name = keyId(k.domain, k.selector);
    // Selector comes from the (untrusted) email header: only plain DNS names may reach the resolver URL.
    if (!DNS_NAME.test(name)) { keys[name] = null; continue; }
    const dns = http.sendRequest({ url: `${config.dohUrl}?name=${encodeURIComponent(name)}&type=TXT`, method: "GET",
      headers: { accept: "application/dns-json" } }).result();
    const body = dns.statusCode === 200 ? JSON.parse(text(dns.body)) as { Status: number; Answer?: { name: string; type: number; data: string }[] } : null;
    // Accept only the TXT record at the requested name, following its CNAME chain (Amazon keys are CNAMEs to amazonses).
    const norm = (n: string) => n.replace(/\.$/, "").toLowerCase(), answers = body?.Status === 0 ? body.Answer ?? [] : [];
    let target = name.toLowerCase();
    for (let hop = 0, next; hop < 8 && (next = answers.find(a => a.type === 5 && norm(a.name) === target)); hop++) target = norm(next.data);
    const txt = answers.find(a => a.type === 16 && norm(a.name) === target);
    keys[name] = txt ? [...txt.data.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1]).join("") : null;
  }
  return JSON.stringify(verifyOrderEmailWithKeys({ raw, expected: evidence.expected, merchant, keys, now: new Date(nowIso) }));
};

const postResult = (http: HTTPSendRequester, config: Config, body: string, token: string): number =>
  http.sendRequest({ url: `${config.apiUrl}/v1/internal/verification-results`, method: "POST",
    headers: { "content-type": "application/json", "x-cre-token": token }, body: toBase64(new TextEncoder().encode(body)) }).result().statusCode;

export const onRequest = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
  const input = decodeJson(payload.input) as Input;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.orderId) || !/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error("invalid trigger payload");
  const token = runtime.getSecret({ id: "CRE_VERIFIER_TOKEN" }).result().value;
  const nowIso = runtime.now().toISOString();
  const http = new HTTPClient();
  const verdict = http.sendRequest(runtime, verifyOnNode, consensusIdenticalAggregation<string>())(runtime.config, input, token, nowIso).result();
  const status = http.sendRequest(runtime, postResult, consensusIdenticalAggregation<number>())(runtime.config,
    JSON.stringify({ orderId: input.orderId, sha256: input.sha256, result: JSON.parse(verdict) }), token).result();
  const { verdict: outcome, criteria } = JSON.parse(verdict) as { verdict: string; criteria: { id: string; result: string }[] };
  // Only check ids/results leave the workflow log; observed values (names, addresses) stay with the coordinator.
  const summary = `${outcome} ${criteria.map(c => `${c.id}:${c.result}`).join(" ")}`;
  runtime.log(`CRE verdict for order ${input.orderId}: ${summary}; coordinator responded ${status}`);
  return summary;
};

export const initWorkflow = () => [handler(new HTTPCapability().trigger({}), onRequest)];

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
