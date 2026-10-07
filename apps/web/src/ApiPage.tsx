import { useEffect, useState } from "react";
import { label, request } from "./api";
import type { Capabilities } from "./api";
import { Arrow } from "./ui";

const ENDPOINTS: [string, string, string][] = [
  ["GET", "/v1/orders", "Open orders on the book (public)"],
  ["POST", "/v1/action-plans", "Prepare any command; returns a plan to review"],
  ["POST", "/v1/intents", "Buyer: post an order (commit a create_intent plan)"],
  ["POST", "/v1/orders/:id/claims", "Filler: claim an order"],
  ["GET", "/v1/orders/:id/escrow-terms", "Buyer: Masumi escrow terms to fund"],
  ["POST", "/v1/orders/:id/funding", "Buyer: record the escrow lock it submitted"],
  ["GET", "/v1/orders/:id/assignment", "Filler: ship-to details, only after funding"],
  ["POST", "/v1/orders/:id/purchase-attempts", "Filler: register the checkout before buying"],
  ["POST", "/v1/orders/:id/evidence-uploads", "Filler: upload the merchant email (message/rfc822)"],
  ["POST", "/v1/orders/:id/evidence", "Filler: submit the uploaded email as proof"],
  ["GET", "/v1/orders/:id/control", "Anyone on the order: state, facts, deadlines, next actions"],
  ["POST", "/v1/orders/:id/evidence-reviews", "Buyer: approve or reject proof that did not pass"],
  ["POST", "/v1/orders/:id/refund-requests", "Buyer: ask the escrow for a refund"],
  ["POST", "/v1/orders/:id/refund-authorizations", "Filler: agree to refund the buyer"],
];

const TOOLS: [string, string][] = [
  ["place_order", "Posts the item, total and payout after checking the buyer's policy"],
  ["fund_escrow", "Locks the payout in Masumi escrow with the buyer's own key"],
  ["get_order_status", "Plain-language status, checks, deadlines and transaction links"],
  ["review_evidence", "Approve or reject proof; rejecting requests a refund"],
  ["request_refund", "Ask the escrow for a refund"],
  ["get_buyer_profile", "Delivery city and spending policy configured for this agent"],
];

export function ApiPage() {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    request<Capabilities>("/capabilities").then(setCaps, () => setFailed(true));
  }, []);
  const i = caps?.integration;
  return (
    <main id="main" className="workspace container api-page">
      <div className="workspace-topline">
        <a className="text-link" href="#">
          ← Overview
        </a>
        <span className="eyebrow">
          <span className={`status-square${caps ? "" : " offline"}`} />
          {caps ? "API CONNECTED" : failed ? "API NOT CONNECTED" : "CONNECTING…"}
        </span>
      </div>
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">GLOBAL ORDER BOOK / API</span>
          <h1>One API for agents and people.</h1>
          <p>The dashboard and the Claude buyer agent use the same commands. Every write is prepared, reviewed, then committed with an idempotency key.</p>
        </div>
      </div>
      {i && (
        <div className="workspace-stats">
          <div>
            <span>PAYMENT</span>
            <strong>
              Masumi <small>/ {label(i.payment.execution)} · Preprod</small>
            </strong>
          </div>
          <div>
            <span>MERCHANT</span>
            <strong>
              {i.merchant.id === "amazon-in" ? "Amazon.in" : i.merchant.id} <small>/ {label(i.merchant.checkout)}</small>
            </strong>
          </div>
          <div>
            <span>PROOF</span>
            <strong>
              {i.verifier.execution === "CRE_SIMULATION" ? "Chainlink CRE" : label(i.verifier.execution)}{" "}
              <small>/ {i.verifier.execution === "CRE_SIMULATION" ? "simulation" : "verifier"}</small>
            </strong>
          </div>
          <div>
            <span>CONTRACT</span>
            <strong>
              v{caps?.contractVersion} <small>/ {caps?.commands.length} commands</small>
            </strong>
          </div>
        </div>
      )}
      <section className="api-section">
        <h2>Buyer agent tools (Claude MCP)</h2>
        <div className="table-scroll">
          <table>
            <tbody>
              {TOOLS.map(([name, text]) => (
                <tr key={name}>
                  <td>
                    <code>{name}</code>
                  </td>
                  <td>{text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="api-section">
        <h2>HTTP endpoints</h2>
        <div className="table-scroll">
          <table>
            <tbody>
              {ENDPOINTS.map(([method, path, text]) => (
                <tr key={method + path}>
                  <td className="numeric">{method}</td>
                  <td>
                    <code>{path}</code>
                  </td>
                  <td>{text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {caps && (
        <section className="api-section">
          <h2>Not production yet</h2>
          <ul className="api-limits">
            {caps.blockers.map((item) => (
              <li key={item}>{label(item)}</li>
            ))}
          </ul>
        </section>
      )}
      <div className="workspace-note">
        <span>+</span>
        <p>
          Machine-readable:{" "}
          <a href="/v1/capabilities" target="_blank" rel="noreferrer">
            capabilities <Arrow diagonal />
          </a>{" "}
          ·{" "}
          <a href="/v1/capabilities/commands" target="_blank" rel="noreferrer">
            command schema <Arrow diagonal />
          </a>
        </p>
      </div>
    </main>
  );
}
