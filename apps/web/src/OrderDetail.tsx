import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { act, errorMessage, explorer, fiat, label, observePurchase, request, tokens, uploadEvidence } from "./api";
import type { Assignment, Control, Session } from "./api";
import { Arrow, Notice } from "./ui";

type Escrow = {
  nativeState?: string;
  grossBaseUnits?: string;
  deadlines?: { payBy: string; submitResultBy: string; unlockAt: string; externalDisputeUnlockAt: string };
  txs?: { kind: string; status?: string; txHash: string }[];
};
type Verification = {
  verdict: string;
  execution: string;
  criteria: { id: string; result: "PASS" | "FAIL" | "UNKNOWN"; expected: string; observed: string | null }[];
};
type Settlement = { state?: string; txs?: { kind: string; txHash: string }[] };

const CHECKS: Record<string, string> = {
  MERCHANT: "Merchant is Amazon.in",
  DKIM_SIGNATURE: "Email signed by amazon.in (DKIM)",
  NONCE: "Order code in the ship-to name",
  RECIPIENT_NAME: "Ship-to name matches",
  RECIPIENT_CITY: "Ship-to city matches",
  RECIPIENT_REGION: "Ship-to state matches",
  ITEM: "Item matches the order",
  QUANTITY: "Quantity matches",
  TOTAL: "Total matches",
  MERCHANT_ORDER_ID: "Amazon order number matches",
  PLACED_AFTER_FUNDING: "Placed after escrow was funded",
  PLACED_BEFORE_DEADLINE: "Placed before the deadline",
};

const time = (iso?: string) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";

function Step({ n, title, state, children }: { n: number; title: string; state: "done" | "active" | "waiting" | "failed"; children?: ReactNode }) {
  return (
    <li className={`flow-step is-${state}`}>
      <span className="flow-index">{state === "done" ? "✓" : state === "failed" ? "×" : String(n).padStart(2, "0")}</span>
      <div>
        <h3>{title}</h3>
        {children}
      </div>
    </li>
  );
}

function Copy({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="copy-button"
      onClick={() =>
        void navigator.clipboard.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        })
      }
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function Tx({ kind, hash }: { kind: string; hash: string }) {
  return (
    <a className="tx-link" href={explorer(hash)} target="_blank" rel="noreferrer">
      {label(kind)} · {hash.slice(0, 10)}… <Arrow diagonal />
    </a>
  );
}

export function OrderDetail({
  id,
  session,
  revision,
  onClose,
}: {
  id: string;
  session: Session;
  revision: number;
  onClose: () => void;
}) {
  const [control, setControl] = useState<Control | null>(null);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [orderNumber, setOrderNumber] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [tick, setTick] = useState(0);

  // Poll: funding, CRE verdict and escrow state all change in the background.
  useEffect(() => {
    let active = true;
    request<Control>(`/orders/${encodeURIComponent(id)}/control`, session.token)
      .then((value) => {
        if (active) setControl(value);
      })
      .catch((reason) => active && setError(errorMessage(reason)));
    const timer = setTimeout(() => setTick((value) => value + 1), 4_000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id, session, revision, tick]);

  const fact = <K extends Control["facts"][number]["key"]>(key: K) =>
    control?.facts.find((item) => item.key === key)?.value as Extract<Control["facts"][number], { key: K }>["value"] | undefined;
  const funded = fact("funding") === "CONFIRMED";
  const escrow = fact("escrow") as Escrow | undefined;
  const purchase = fact("merchantPurchase") ?? null;
  const evidence = fact("evidence") as { evidenceId: string } | undefined;
  const verification = fact("verification") as Verification | undefined;
  const settlement = fact("settlement") as Settlement | undefined;
  const outcome = control?.outcome;
  const can = (command: string) => control?.actions.some((a) => a.command === command && a.status === "AVAILABLE");

  useEffect(() => {
    if (!funded || assignment) return;
    request<Assignment>(`/orders/${encodeURIComponent(id)}/assignment`, session.token)
      .then(setAssignment)
      .catch((reason) => setError(errorMessage(reason)));
  }, [funded, assignment, id, session]);

  async function run(step: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await step();
      setTick((value) => value + 1);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  // Registering the attempt first guards against buying twice if this page is reloaded mid-checkout.
  const startCheckout = () =>
    run(async () => {
      const purchaseOperationId = `purchase-${id}`;
      await act({ command: "register_purchase", orderId: id, purchaseOperationId }, session.token, `register-${id}`);
      await observePurchase(id, session.token, { purchaseOperationId, state: "SUBMITTING" });
    });
  const confirmOrder = () =>
    run(async () => {
      if (!purchase) return;
      await observePurchase(id, session.token, {
        purchaseOperationId: purchase.operationId,
        state: "ORDERED",
        merchantOrderId: orderNumber.trim(),
      });
    });
  const submitProof = () =>
    run(async () => {
      if (!file || !purchase?.merchantOrderId) return;
      const upload = await uploadEvidence(id, session.token, file);
      await act(
        {
          command: "submit_evidence",
          orderId: id,
          purchaseOperationId: purchase.operationId,
          merchantOrderId: purchase.merchantOrderId,
          evidenceId: upload.evidenceId,
        },
        session.token,
        `evidence-${id}-${upload.evidenceId.slice(0, 12)}`,
      );
      setFile(null);
    });
  const authorizeRefund = () =>
    run(() => act({ command: "authorize_refund", orderId: id }, session.token, `authref-${id}`));

  const ordered = purchase?.state === "ORDERED";
  const verdict = outcome?.verification ?? "NOT_STARTED";
  const passed = verdict === "PASS" || verdict === "MANUAL_APPROVED";
  const failed = verdict === "FAIL" || verdict === "MANUAL_REJECTED" || verdict === "INCONCLUSIVE";
  const paid = outcome?.settlement === "PAID";
  const refunded = outcome?.settlement === "REFUNDED";
  const lock = escrow?.txs?.find((tx) => tx.kind === "payment");
  const allTxs = [...(escrow?.txs ?? []), ...(settlement?.txs ?? [])].filter(
    (tx, index, list) => list.findIndex((other) => other.txHash === tx.txHash) === index,
  );

  return (
    <aside className="order-detail">
      <div className="panel-heading">
        <h2>Fill this order</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close order detail">
          ×
        </button>
      </div>
      <code className="order-id">{id}</code>
      {error && <Notice error>{error}</Notice>}
      {!control && !error && (
        <p className="empty-copy" role="status">
          Loading order…
        </p>
      )}
      {control && (
        <>
          <p className="detail-summary">{control.summary}</p>
          <ol className="flow">
            <Step n={1} title="Claimed" state="done">
              <p>This order is reserved for you.</p>
            </Step>

            <Step n={2} title="Buyer locks the payout" state={funded ? "done" : "active"}>
              {funded ? (
                <p>
                  {escrow?.grossBaseUnits ? tokens(escrow.grossBaseUnits) : "Payout"} locked in Masumi escrow.
                </p>
              ) : (
                <p className="waiting">
                  Waiting for the buyer's agent to lock the payout. Preprod confirmation plus Masumi indexing can take
                  up to ~10 minutes. Do not buy yet.
                </p>
              )}
              {lock && <Tx kind="escrow lock" hash={lock.txHash} />}
            </Step>

            <Step n={3} title="Buy it on Amazon.in" state={ordered ? "done" : funded ? "active" : "waiting"}>
              {funded && assignment && !ordered && (
                <>
                  <dl className="ship-to">
                    <div>
                      <dt>Item</dt>
                      <dd>
                        {assignment.itemTitle ?? "See order"} × {assignment.quantity}
                      </dd>
                    </div>
                    <div>
                      <dt>Pay at most</dt>
                      <dd>{fiat(assignment.maximumChargeMinor, assignment.currency)} incl. delivery</dd>
                    </div>
                    {Object.entries(assignment.recipient).map(([key, value]) => (
                      <div key={key} className={key === "name" ? "ship-name" : ""}>
                        <dt>{key === "name" ? "Name (type exactly)" : label(key)}</dt>
                        <dd>
                          <span>{value}</span>
                          <Copy value={value} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="field-hint">
                    The code <strong>{assignment.nonce}</strong> must be the first word of the delivery name. Pay by card
                    or UPI (not cash on delivery).
                  </p>
                  {!purchase ? (
                    <button className="button primary" disabled={busy} onClick={() => void startCheckout()}>
                      I'm placing the order now <Arrow />
                    </button>
                  ) : (
                    <form
                      className="inline-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void confirmOrder();
                      }}
                    >
                      <label className="field">
                        Amazon order number
                        <input
                          value={orderNumber}
                          onChange={(event) => setOrderNumber(event.target.value)}
                          placeholder="404-1234567-1234567"
                          pattern="[A-Za-z0-9_\-]+"
                          required
                        />
                      </label>
                      <button className="button primary" disabled={busy || !orderNumber.trim()}>
                        Order placed <Arrow />
                      </button>
                    </form>
                  )}
                </>
              )}
              {ordered && <p>Amazon order {purchase?.merchantOrderId} placed.</p>}
            </Step>

            <Step n={4} title="Upload the confirmation email" state={evidence ? "done" : ordered ? "active" : "waiting"}>
              {ordered && !evidence && (
                <>
                  <p>In Gmail open the Amazon "Ordered" email → ⋮ → Download message (.eml).</p>
                  <label className={`drop-zone${file ? " has-file" : ""}`}>
                    <input
                      type="file"
                      accept=".eml,message/rfc822"
                      onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                    />
                    {file ? file.name : "Choose or drop the .eml file"}
                  </label>
                  <button className="button primary" disabled={busy || !file} onClick={() => void submitProof()}>
                    {busy ? "Uploading…" : "Submit proof"} <Arrow />
                  </button>
                </>
              )}
              {evidence && <p>Proof submitted · {evidence.evidenceId.slice(0, 12)}…</p>}
            </Step>

            <Step
              n={5}
              title="Chainlink CRE verifies the proof"
              state={passed ? "done" : failed ? "failed" : evidence ? "active" : "waiting"}
            >
              {evidence && !verification && <p className="waiting">CRE workflow is checking the DKIM signature and order details…</p>}
              {verification && (
                <>
                  <p>
                    <span className={`verdict verdict-${verification.verdict.toLowerCase()}`}>{verification.verdict}</span>{" "}
                    {verification.execution === "CRE_SIMULATION"
                      ? "Verified on Chainlink CRE (simulation)"
                      : verification.execution === "MANUAL"
                        ? `Reviewed by the buyer (${label(verdict)})`
                        : label(verification.execution)}
                  </p>
                  <ul className="checks">
                    {verification.criteria.map((check) => (
                      <li key={check.id} className={`check-${check.result.toLowerCase()}`}>
                        <span>{check.result === "PASS" ? "✓" : check.result === "FAIL" ? "×" : "?"}</span>
                        {CHECKS[check.id] ?? label(check.id)}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Step>

            <Step
              n={6}
              title={refunded || outcome?.settlement === "REFUND_PENDING" ? "Escrow refunds the buyer" : "Escrow pays you"}
              state={paid ? "done" : refunded ? "failed" : passed || failed ? "active" : "waiting"}
            >
              {escrow?.deadlines && (passed || failed) && (
                <dl className="timeline">
                  <div>
                    <dt>Result due</dt>
                    <dd>{time(escrow.deadlines.submitResultBy)}</dd>
                  </div>
                  <div>
                    <dt>Dispute window ends</dt>
                    <dd>{time(escrow.deadlines.unlockAt)}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{label(outcome?.settlement ?? "none")}</dd>
                  </div>
                </dl>
              )}
              {paid && <p>Paid. The escrow released the payout to your wallet.</p>}
              {refunded && <p>The buyer was refunded.</p>}
              {can("authorize_refund") && (
                <button className="button" disabled={busy} onClick={() => void authorizeRefund()}>
                  Agree to refund the buyer
                </button>
              )}
            </Step>
          </ol>
          {allTxs.length > 0 && (
            <>
              <h3 className="detail-subheading">On-chain</h3>
              <div className="tx-list">
                {allTxs.map((tx) => (
                  <Tx key={tx.txHash} kind={tx.kind} hash={tx.txHash} />
                ))}
              </div>
            </>
          )}
          <details className="technical-details">
            <summary>Inspect control record</summary>
            <pre>{JSON.stringify(control, null, 2)}</pre>
          </details>
        </>
      )}
    </aside>
  );
}
