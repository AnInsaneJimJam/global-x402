import type { z } from "zod";
import type {
  Actor,
  Command,
  Plan,
  Receipt,
  capabilities,
  controlSchema,
} from "../../../packages/contracts/index";
import type { Procurement } from "../../../packages/procurement/service";

export type { Actor, Command, Plan, Receipt };
export type Control = z.infer<typeof controlSchema>;
export type Capabilities = ReturnType<typeof capabilities>;
export type OpportunityPage = Awaited<ReturnType<Procurement["opportunities"]>>;
export type Opportunity = OpportunityPage["orders"][number];
export type WorkPage = Awaited<ReturnType<Procurement["work"]>>;
export type Session = { token: string; actor: Actor };

export class ApiError extends Error {
  constructor(
    public code: string,
    public effectStatus = "OUTCOME_UNKNOWN",
  ) {
    super(code.toLowerCase().replaceAll("_", " "));
  }
}

export async function request<T>(
  path: string,
  token = "",
  body?: unknown,
  operationId?: string,
): Promise<T> {
  const response = await fetch(`/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(operationId ? { "idempotency-key": operationId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      payload?.error?.code ?? `HTTP_${response.status}`,
      payload?.error?.effectStatus,
    );
  if (payload === null) throw new ApiError("INVALID_API_RESPONSE");
  return payload as T;
}

const routes: Record<Command["command"], string> = {
  create_intent: "/intents",
  claim: "/claims",
  register_purchase: "/purchase-attempts",
  submit_evidence: "/evidence",
  review_evidence: "/evidence-reviews",
  fund_escrow: "/funding",
  request_refund: "/refund-requests",
  authorize_refund: "/refund-authorizations",
};

export function commit(plan: Plan, token: string, operationId: string) {
  const path =
    "orderId" in plan.command
      ? `/orders/${encodeURIComponent(plan.command.orderId)}${routes[plan.command.command]}`
      : "/intents";
  return request<Receipt>(
    path,
    token,
    { planId: plan.id, operationId },
    operationId,
  );
}

// Prepare + commit in one step. A deterministic operation id makes a retry return the same receipt.
export async function act(command: Command, token: string, operationId: string) {
  const plan = await request<Plan>("/action-plans", token, command);
  return commit(plan, token, operationId);
}

export type Assignment = {
  nonce: string;
  merchantId: string;
  itemTitle: string | null;
  itemUrl: string | null;
  quantity: number;
  currency: string;
  maximumChargeMinor: string;
  instructions: string;
  recipient: Record<string, string>;
};

export function observePurchase(
  orderId: string,
  token: string,
  body: { purchaseOperationId: string; state: "SUBMITTING" | "ORDERED"; merchantOrderId?: string },
) {
  return request<{ accepted: boolean }>(
    `/orders/${encodeURIComponent(orderId)}/purchase-observations`,
    token,
    body,
  );
}

// Raw .eml upload (message/rfc822); the server stores it and returns its sha256 as the evidence id.
export async function uploadEvidence(orderId: string, token: string, file: File) {
  const response = await fetch(
    `/v1/orders/${encodeURIComponent(orderId)}/evidence-uploads`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "message/rfc822" },
      body: file,
      signal: AbortSignal.timeout(30_000),
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(payload?.error?.code ?? `HTTP_${response.status}`, payload?.error?.effectStatus);
  return payload as { evidenceId: string; sha256: string; sizeBytes: number };
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === "DEV_AUTH_REQUIRED")
      return "This session token was not accepted. Use a configured buyer or filler token.";
    const known: Record<string, string> = {
      EVIDENCE_REPLAY: "This Amazon order number was already used as proof for another order. One merchant order can settle only one order.",
      EVIDENCE_NOT_FOUND: "Upload the .eml again, then submit.",
      PURCHASE_ALREADY_PLACED: "A purchase is already registered for this order.",
      ORDER_NOT_FUNDED: "Wait until the buyer's escrow lock is confirmed.",
    };
    if (known[error.code]) return known[error.code]!;
    return `${error.message.charAt(0).toUpperCase()}${error.message.slice(1)}.`;
  }
  return "Could not reach the API. Check that the local API and database are running, then try again.";
}

const symbols: Record<string, string> = { INR: "₹", SGD: "S$", USD: "$" };
export function fiat(units: string, currency = "INR") {
  const value = BigInt(units);
  return `${symbols[currency] ?? `${currency} `}${(value / 100n).toLocaleString("en-IN")}.${(value % 100n).toString().padStart(2, "0")}`;
}

// tUSDM has 6 decimals.
export function tokens(units: string) {
  return `${(Number(units) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })} tUSDM`;
}

// What the filler pays per token received: fiat / tokens (lower is better for the filler).
export function rate(fiatMinor: string, netTokenUnits: string) {
  return Number(fiatMinor) / 100 / (Number(netTokenUnits) / 1e6);
}

export const explorer = (tx: string) => `https://preprod.cardanoscan.io/transaction/${tx}`;

// The buyer's product page when given (server only accepts https amazon.in links), else an Amazon.in search for the title.
export const productLink = (title: string | null, url?: string | null) =>
  url ?? `https://www.amazon.in/s?k=${encodeURIComponent(title ?? "")}`;

export function label(value: string) {
  return value.replaceAll("_", " ").replaceAll("-", " ").toLowerCase();
}
