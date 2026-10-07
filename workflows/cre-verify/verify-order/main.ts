// Chainlink CRE Confidential Workflow: verifies a filler's order-confirmation email (DKIM + order checks) inside a TEE.
// Trigger: HTTP payload { orderId, sha256 }. The enclave fetches the evidence and expected terms from the coordinator,
// fetches the merchant's DKIM key over DNS-over-HTTPS, runs the shared dependency-free verifier and posts the verdict
// back (recorded as CRE_SIMULATION here). The email's personal data never leaves the enclave.
import { decodeJson, handlerInTee, HTTPCapability, HTTPClient, Runner,
  type HTTPPayload, type TeeRuntime } from "@chainlink/cre-sdk";
import { dkimKeysNeeded, fromBase64, keyId, toBase64, verifyOrderEmailWithKeys } from "../../../packages/verification/pure";
import { amazonIn } from "../../../packages/merchants/amazon-in";

export type Config = { apiUrl: string; dohUrl: string };
type Input = { orderId: string; sha256: string };
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const DNS_NAME = /^(?=.{1,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const MERCHANTS = { "amazon-in": amazonIn } as const;

type Http = { sendRequest: (req: { url: string; method: string; headers?: Record<string, string>; body?: string }) => { result: () => { statusCode: number; body: Uint8Array } } };

// Runs inside the TEE: the email (buyer name/address), the coordinator token and the per-check observations never
// reach node operators. Only the verdict summary leaves the enclave.
const verifyInEnclave = (http: Http, config: Config, input: Input, token: string, nowIso: string) => {
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
  const result = verifyOrderEmailWithKeys({ raw, expected: evidence.expected, merchant, keys, now: new Date(nowIso) });
  // The full result (with observed values) goes straight from the enclave to the coordinator.
  const posted = http.sendRequest({ url: `${config.apiUrl}/v1/internal/verification-results`, method: "POST",
    headers: { "content-type": "application/json", "x-cre-token": token },
    body: toBase64(new TextEncoder().encode(JSON.stringify({ orderId: input.orderId, sha256: input.sha256, result })))}).result();
  return { verdict: result.verdict, checks: result.criteria.map(c => `${c.id}:${c.result}`).join(" "), status: posted.statusCode };
};

export const onRequest = (runtime: TeeRuntime<Config>, payload: HTTPPayload): string => {
  const input = decodeJson(payload.input) as Input;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.orderId) || !/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error("invalid trigger payload");
  // Released by the Vault DON only into the attested enclave.
  const token = runtime.getSecret({ id: "CRE_VERIFIER_TOKEN" }).result().value;
  const client = new HTTPClient();
  const http: Http = { sendRequest: req => client.sendRequest(runtime, req) };
  const out = verifyInEnclave(http, runtime.config, input, token, runtime.now().toISOString());
  if (out.status !== 200) throw new Error(`coordinator rejected the verdict: HTTP ${out.status}`);
  // Simulation-only log (no personal data). In a real enclave, logs never leave the TEE.
  runtime.log(`CRE confidential verdict for order ${input.orderId}: ${out.verdict} ${out.checks}; coordinator responded ${out.status}`);
  return `${out.verdict} ${out.checks}`;
};

// Confidential Workflow: the handler executes in an AWS Nitro enclave (the only registered TEE today).
export const initWorkflow = () => [handlerInTee(new HTTPCapability().trigger({}), onRequest, [{ tee: "nitro", regions: ["us-west-2"] }])];

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
