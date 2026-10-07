import { useState } from "react";
import type { FormEvent } from "react";
import { errorMessage, request } from "./api";
import type { Actor, Session } from "./api";
import { Arrow, Modal, Notice } from "./ui";

export function SessionDialog({
  onConnect,
  onClose,
}: {
  onConnect: (session: Session) => void;
  onClose: () => void;
}) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const actor = await request<Actor>("/session", token.trim());
      onConnect({ token: token.trim(), actor });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Connect a local session" onClose={onClose} locked={busy}>
      <p className="modal-copy">
        Use the buyer or filler token configured in your local API. Your role is
        verified by the server.
      </p>
      <form onSubmit={(event) => void connect(event)}>
        <label className="field">
          Session token
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            required
            autoFocus
            placeholder="Enter your development token"
          />
        </label>
        <p className="field-hint">
          Kept in memory for this visit. This prototype uses development
          sessions; wallet authentication is not available.
        </p>
        {error && <Notice error>{error}</Notice>}
        <div className="modal-actions">
          <button
            type="button"
            className="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button className="button primary" disabled={busy || !token.trim()}>
            {busy ? "Connecting…" : "Connect session"} <Arrow />
          </button>
        </div>
      </form>
    </Modal>
  );
}
