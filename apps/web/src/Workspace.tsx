import { useEffect, useMemo, useRef, useState } from "react";
import { errorMessage, fiat, rate, request, tokens } from "./api";
import type {
  Capabilities,
  Opportunity,
  OpportunityPage,
  Receipt,
  Session,
  WorkPage,
} from "./api";
import { Arrow, Notice } from "./ui";
import { SessionDialog } from "./SessionDialog";
import { OrderDetail } from "./OrderDetail";
import { useCommands } from "./CommandDialog";

type Row = Pick<
  Opportunity,
  "id" | "merchantId" | "itemTitle" | "quantity" | "currency" | "fiatMinor" | "netTokenUnits"
> & { sample?: boolean };

// Illustrative orders so the book is not empty on camera. Never stored, never claimable.
const SAMPLES: Row[] = [
  ["Logitech M235 Wireless Mouse", "64900", "7500000"],
  ["Classmate Pulse 6 Subject Notebook", "28000", "3100000"],
  ["boAt Bassheads 100 Wired Earphones", "39900", "4600000"],
  ["Milton Thermosteel Flask 500 ml", "79900", "8800000"],
  ["Cello Butterflow Ball Pen, Pack of 10", "18500", "2000000"],
  ["Amazon Basics USB-C Cable 1.2 m", "34900", "3900000"],
].map(([itemTitle, fiatMinor, netTokenUnits], index) => ({
  id: `sample-${index + 1}`,
  merchantId: "amazon-in",
  itemTitle: itemTitle!,
  quantity: 1,
  currency: "INR" as const,
  fiatMinor: fiatMinor!,
  netTokenUnits: netTokenUnits!,
  sample: true,
}));

const SESSION_KEY = "gob-session";
const RANGE_KEY = "gob-rate-range";

function savedSession(): Session | null {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") as Session | null;
  } catch {
    return null;
  }
}

function savedRange(): [number, number] {
  try {
    const value = JSON.parse(localStorage.getItem(RANGE_KEY) ?? "null") as [number, number] | null;
    if (value && value.every((n) => Number.isFinite(n))) return value;
  } catch {
    /* fall through to defaults */
  }
  return [60, 95];
}

export function Workspace() {
  const [session, setSessionState] = useState<Session | null>(savedSession);
  const [connecting, setConnecting] = useState(false);
  const [tab, setTab] = useState<"opportunities" | "work">("opportunities");
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [work, setWork] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [range, setRange] = useState<[number, number]>(savedRange);
  const requestVersion = useRef(0);

  function setSession(value: Session | null) {
    setSessionState(value);
    try {
      if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* session then lasts for this page only */
    }
  }
  function success(receipt: Receipt) {
    setNotice(
      receipt.command === "claim"
        ? "Order claimed. The buyer's agent now locks the payout in escrow — wait for the lock before buying."
        : `Recorded: ${receipt.command.replaceAll("_", " ")}.`,
    );
    setSelected(receipt.orderId);
    setTab("work");
    setRevision((value) => value + 1);
  }
  const actions = useCommands(session, success);

  async function load(quiet = false) {
    const version = ++requestVersion.current;
    if (!quiet) setLoading(true);
    try {
      const book = await request<OpportunityPage>("/orders");
      const mine = session ? await request<WorkPage>("/work", session.token) : null;
      if (version !== requestVersion.current) return;
      setOpportunities(book.orders);
      setWork(mine?.orders ?? []);
      setError("");
    } catch (reason) {
      if (version === requestVersion.current) setError(errorMessage(reason));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    request<Capabilities>("/capabilities")
      .then((value) => active && setCapabilities(value))
      .catch(() => active && setCapabilities(null));
    return () => {
      active = false;
    };
  }, [revision]);
  // The book is live: new orders from buyer agents appear without a reload.
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(true), 4_000);
    return () => {
      clearInterval(timer);
      requestVersion.current++;
    };
  }, [session, revision]);
  useEffect(() => {
    try {
      localStorage.setItem(RANGE_KEY, JSON.stringify(range));
    } catch {
      /* not persisted */
    }
  }, [range]);

  const [low, high] = range;
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const all: Row[] = [...opportunities, ...SAMPLES];
    return all
      .map((row) => ({ ...row, rate: rate(row.fiatMinor, row.netTokenUnits) }))
      .filter((row) =>
        `${row.itemTitle ?? ""} ${row.merchantId} ${row.id}`.toLowerCase().includes(query),
      )
      .sort((a, b) => a.rate - b.rate);
  }, [opportunities, search]);
  const inRange = (value: number) => value >= low && value <= high;
  // Same rule as the filler CLI: cheapest fiat per token among live orders you would accept.
  const best = rows.find((row) => !row.sample && inRange(row.rate))?.id;
  const live = rows.filter((row) => !row.sample).length;
  const verifier = capabilities?.merchants[0]?.verifier;
  const disabled = actions.busy || actions.blocked;
  const filler = session?.actor.role === "FILLER";

  return (
    <main id="main" className="workspace container">
      <div className="workspace-topline">
        <a className="text-link" href="#">
          ← Overview
        </a>
        <span className="eyebrow">
          <span className={`status-square${capabilities ? "" : " offline"}`} />
          {capabilities ? "API CONNECTED" : "API NOT CONNECTED"}
        </span>
      </div>
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">GLOBAL ORDER BOOK / FILLER DESK</span>
          <h1>The orderbook.</h1>
          <p>Orders posted by buyers' agents. Pick the one that fits your rate.</p>
        </div>
        <div className="workspace-session">
          {session ? (
            <>
              <span className="outline-tag">
                {session.actor.role} / {session.actor.id}
              </span>
              <button
                className="text-link"
                disabled={actions.busy}
                onClick={() => {
                  setSession(null);
                  setSelected(null);
                  setNotice("");
                }}
              >
                Disconnect ↗
              </button>
            </>
          ) : (
            <button className="button primary" onClick={() => setConnecting(true)}>
              Connect as filler <Arrow />
            </button>
          )}
        </div>
      </div>
      <div className="mode-banner">
        <span className="outline-tag live-tag">LIVE TESTNET</span>
        <span>
          Real Amazon.in orders. Escrow in Masumi on Cardano Preprod with test tUSDM. Proofs are
          checked by a Chainlink CRE workflow (local simulation).
        </span>
        <a href="#api" aria-label="View the API">
          <Arrow diagonal />
        </a>
      </div>
      <div className="workspace-stats">
        <div>
          <span>NETWORK</span>
          <strong>
            Cardano <small>/ Preprod</small>
          </strong>
        </div>
        <div>
          <span>ESCROW</span>
          <strong>
            Masumi <small>/ tUSDM</small>
          </strong>
        </div>
        <div>
          <span>MERCHANT</span>
          <strong>
            Amazon.in <small>/ you check out</small>
          </strong>
        </div>
        <div>
          <span>PROOF</span>
          <strong>
            {verifier === "CRE_SIMULATION" ? "Chainlink CRE" : "DKIM email"}{" "}
            <small>/ {verifier === "CRE_SIMULATION" ? "simulated" : "worker"}</small>
          </strong>
        </div>
      </div>
      {notice && <Notice>{notice}</Notice>}
      {actions.error && <Notice error>{actions.error}</Notice>}
      {actions.recovery}
      <div className="workspace-body">
        <section className="orderbook-panel" aria-label="Orderbook">
          <div className="orderbook-toolbar">
            <div className="tabs" role="tablist" aria-label="Orders">
              <button
                role="tab"
                aria-selected={tab === "opportunities"}
                className={tab === "opportunities" ? "active" : ""}
                onClick={() => setTab("opportunities")}
              >
                Open orders <span className="tab-count">{live}</span>
              </button>
              <button
                role="tab"
                aria-selected={tab === "work"}
                className={tab === "work" ? "active" : ""}
                onClick={() => setTab("work")}
              >
                My orders <span className="tab-count">{work.length}</span>
              </button>
            </div>
            <span className="eyebrow live-pulse">
              <span className="status-square" /> LIVE
            </span>
          </div>
          {tab === "opportunities" && (
            <div className="rate-range">
              <span className="eyebrow">YOUR RATE</span>
              <label>
                from ₹
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={low}
                  aria-label="Lowest rupees per tUSDM you accept"
                  onChange={(event) => setRange([Number(event.target.value), high])}
                />
              </label>
              <label>
                to ₹
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={high}
                  aria-label="Highest rupees per tUSDM you accept"
                  onChange={(event) => setRange([low, Number(event.target.value)])}
                />
              </label>
              <span className="muted">per tUSDM you receive</span>
            </div>
          )}
          <div className="search-row">
            <label className="search-input">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                aria-label="Search orders"
                placeholder={tab === "work" ? "Search by order ID…" : "Search item or order…"}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <button className="button compact" disabled={loading} onClick={() => setRevision((v) => v + 1)}>
              ↻ <span>Refresh</span>
            </button>
          </div>
          <div id="order-results" role="tabpanel" aria-busy={loading}>
            {error ? (
              <div className="empty-state">
                <span className="empty-symbol">↯</span>
                <h2>Connection interrupted.</h2>
                <p>{error}</p>
                <button className="button" onClick={() => setRevision((v) => v + 1)}>
                  Try again <Arrow />
                </button>
              </div>
            ) : loading && opportunities.length === 0 && work.length === 0 ? (
              <div className="empty-state" role="status">
                <div className="loading-bars">
                  <i />
                  <i />
                  <i />
                </div>
                <p>Reading the orderbook…</p>
              </div>
            ) : tab === "opportunities" ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Item / Merchant</th>
                      <th>You spend</th>
                      <th>You receive</th>
                      <th>Rate</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((item) => (
                      <tr
                        key={item.id}
                        className={[
                          item.sample ? "sample-row" : "",
                          inRange(item.rate) ? "" : "out-of-range",
                          item.id === best ? "best-row" : "",
                        ].join(" ")}
                      >
                        <td>
                          <strong>{item.itemTitle ?? "Item"}</strong>
                          <span>
                            {item.merchantId === "amazon-in" ? "Amazon.in" : item.merchantId} · Qty {item.quantity}
                          </span>
                          {item.sample ? (
                            <span className="outline-tag sample-tag">SAMPLE</span>
                          ) : (
                            <code>{item.id.slice(0, 8)}</code>
                          )}
                          {item.id === best && <span className="outline-tag best-tag">BEST MATCH</span>}
                        </td>
                        <td className="numeric">{fiat(item.fiatMinor, item.currency)}</td>
                        <td className="numeric">
                          {tokens(item.netTokenUnits)}
                          <span>from escrow</span>
                        </td>
                        <td className="numeric">
                          ₹{item.rate.toFixed(2)}
                          <span>{inRange(item.rate) ? "in your range" : "outside range"}</span>
                        </td>
                        <td>
                          {item.sample ? (
                            <span className="table-status">Sample listing</span>
                          ) : (
                            <button
                              className={item.id === best ? "button primary compact" : "button compact"}
                              disabled={disabled || (session !== null && !filler)}
                              onClick={() =>
                                session
                                  ? void actions.prepare({ command: "claim", orderId: item.id })
                                  : setConnecting(true)
                              }
                            >
                              {session && !filler ? "Filler only" : "Claim"} <Arrow />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {live === 0 && (
                  <p className="book-hint">
                    No live orders yet. Ask your Claude buyer agent to place one — it appears here
                    within seconds.
                  </p>
                )}
              </div>
            ) : !session ? (
              <div className="empty-state">
                <span className="empty-symbol">↗</span>
                <h2>Your orders live here.</h2>
                <p>Connect your filler session to follow claimed orders through purchase, proof and payout.</p>
                <button className="button primary" onClick={() => setConnecting(true)}>
                  Connect as filler <Arrow />
                </button>
              </div>
            ) : work.length === 0 ? (
              <div className="empty-state">
                <span className="empty-symbol">[ + ]</span>
                <h2>A clean slate.</h2>
                <p>Claim an open order and it appears here.</p>
              </div>
            ) : (
              <div className="work-list">
                {work
                  .filter((id) => id.toLowerCase().includes(search.trim().toLowerCase()))
                  .map((id) => (
                    <button
                      key={id}
                      className={selected === id ? "work-row selected" : "work-row"}
                      onClick={() => setSelected(id)}
                    >
                      <div>
                        <span className="eyebrow">CLAIMED ORDER</span>
                        <code>{id}</code>
                      </div>
                      <span>
                        Open <Arrow />
                      </span>
                    </button>
                  ))}
              </div>
            )}
          </div>
          <div className="panel-footer">
            <span>SAME API YOUR AGENT USES</span>
            <a href="#api">API reference ↗</a>
          </div>
        </section>
        {selected && session && (
          <OrderDetail
            key={selected}
            id={selected}
            session={session}
            revision={revision}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
      <div className="workspace-note">
        <span>+</span>
        <p>
          Purchase, proof verification and settlement are separate outcomes. You are paid only after
          the Chainlink CRE check passes and the escrow releases on chain.
        </p>
      </div>
      {connecting && (
        <SessionDialog
          onConnect={(value) => {
            setSession(value);
            setConnecting(false);
          }}
          onClose={() => setConnecting(false)}
        />
      )}
      {actions.dialog}
    </main>
  );
}
