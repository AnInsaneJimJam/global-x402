import { useEffect, useState } from "react";
import { ApiError, commit, errorMessage, label, request } from "./api";
import type { Command, Plan, Receipt, Session } from "./api";
import { Arrow, Modal, Notice } from "./ui";

type Pending = { plan: Plan; operationId: string };
const descriptions: Partial<Record<Command["command"], string>> = {
  claim:
    "Reserve this order for you. The buyer's agent then locks the payout in Masumi escrow; you only buy after the lock confirms.",
};

export function useCommands(
  session: Session | null,
  onSuccess: (receipt: Receipt) => void,
) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = session ? `gob-operation:${session.actor.id}` : "";
  useEffect(() => {
    setPlan(null);
    setPending(null);
    setError("");
    if (!key) return;
    try {
      const saved = sessionStorage.getItem(key);
      if (saved) {
        const value = JSON.parse(saved) as Pending;
        if (
          value.plan?.actor.id === session?.actor.id &&
          typeof value.operationId === "string"
        )
          setPending(value);
      }
    } catch {
      setError(
        "Could not read the saved operation. Keep this tab open while completing actions.",
      );
    }
  }, [key, session?.actor.id]);

  async function prepare(command: Command) {
    if (!session || busy || pending) return false;
    setBusy(true);
    setError("");
    try {
      setPlan(await request<Plan>("/action-plans", session.token, command));
      return true;
    } catch (reason) {
      setError(errorMessage(reason));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function complete(receipt: Receipt) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* A repeated operation remains idempotent. */
    }
    setPlan(null);
    setPending(null);
    setError("");
    onSuccess(receipt);
  }

  async function execute() {
    if (!session || busy || (!plan && !pending)) return;
    setBusy(true);
    setError("");
    const operation = pending ?? {
      plan: plan!,
      operationId: crypto.randomUUID(),
    };
    try {
      sessionStorage.setItem(key, JSON.stringify(operation));
    } catch {
      setError(
        "Enable session storage to preserve operation recovery before continuing.",
      );
      setBusy(false);
      return;
    }
    setPending(operation);
    setPlan(null);
    try {
      complete(
        await commit(operation.plan, session.token, operation.operationId),
      );
    } catch (reason) {
      if (reason instanceof ApiError && reason.effectStatus === "NOT_STARTED") {
        try {
          sessionStorage.removeItem(key);
        } catch {
          /* Safe to reconcile this ID later. */
        }
        setPending(null);
      }
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function reconcile() {
    if (!session || !pending || busy) return;
    setBusy(true);
    setError("");
    try {
      complete(
        await request<Receipt>(
          `/operations/${encodeURIComponent(pending.operationId)}`,
          session.token,
        ),
      );
    } catch (reason) {
      setError(
        reason instanceof ApiError && reason.code === "NOT_FOUND"
          ? "No receipt was found yet. Retry this same operation to resolve it safely."
          : errorMessage(reason),
      );
    } finally {
      setBusy(false);
    }
  }

  return {
    prepare,
    busy,
    blocked: !!pending,
    error,
    recovery: pending && (
      <Notice>
        <strong>Operation awaiting confirmation</strong>
        <p>Check the recorded result before starting another action.</p>
        <code>{pending.operationId}</code>
        <div className="button-row">
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void reconcile()}
          >
            Check result
          </button>
          <button
            className="button"
            disabled={busy}
            onClick={() => void execute()}
          >
            Retry same operation
          </button>
        </div>
      </Notice>
    ),
    dialog: plan && (
      <Modal title="Review action" onClose={() => setPlan(null)} locked={busy}>
        <span className="eyebrow">
          PREPARED / {label(plan.command.command)}
        </span>
        <p className="modal-copy">{descriptions[plan.command.command] ?? label(plan.command.command)}</p>
        <dl className="detail-list">
          <div>
            <dt>Actor</dt>
            <dd>
              {plan.actor.id} / {plan.actor.role}
            </dd>
          </div>
          <div>
            <dt>Plan expires</dt>
            <dd>{new Date(plan.expiresAt).toLocaleTimeString()}</dd>
          </div>
          {"orderId" in plan.command && (
            <div>
              <dt>Order</dt>
              <dd>{plan.command.orderId}</dd>
            </div>
          )}
          {plan.command.command === "create_intent" &&
            Object.entries(plan.command.input).map(([field, value]) => (
              <div key={field}>
                <dt>{field}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
        </dl>
        <div className="modal-actions">
          <button className="button" onClick={() => setPlan(null)}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void execute()}
          >
            {busy ? "Committing…" : "Confirm action"} <Arrow />
          </button>
        </div>
      </Modal>
    ),
  };
}
