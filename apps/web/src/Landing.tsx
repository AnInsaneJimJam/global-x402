import { Arrow, Mark } from "./ui";
import { DotField } from "./DotField";
import { useRef, useState } from "react";
import { useLandingMotion, useReducedMotion } from "./useLandingMotion";

const steps = [
  [
    "01",
    "Post the intent.",
    "Tell your Claude agent what you need. It posts the item, merchant and payout on the orderbook.",
    "LIVE / CLAUDE MCP AGENT",
  ],
  [
    "02",
    "Find the other side.",
    "A filler picks the best order for their rate and claims it. Your agent locks the payout in Masumi escrow.",
    "LIVE / CARDANO PREPROD",
  ],
  [
    "03",
    "Purchase with proof.",
    "The filler buys it on Amazon.in and uploads the DKIM-signed confirmation email. Chainlink CRE checks it against the order.",
    "LIVE / CRE SIMULATION",
  ],
  [
    "04",
    "Close the loop.",
    "A passing proof releases the escrow to the filler. A failed or missing proof refunds the buyer.",
    "LIVE / MASUMI ESCROW",
  ],
];

export function Landing() {
  const root = useRef<HTMLElement>(null);
  const [paused, setPaused] = useState(false);
  const reduced = useReducedMotion();
  const motionEnabled = !paused && !reduced;
  useLandingMotion(root, motionEnabled);
  return (
    <main id="main" ref={root} data-motion={motionEnabled ? "on" : "off"}>
      <section className="hero">
        <DotField animated={motionEnabled} />
        <div className="hero-grid container">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="status-square" /> AGENT COMMERCE, IN THE REAL
              WORLD
            </div>
            <h1>
              Intent to
              <br />
              <span>execution.</span>
            </h1>
            <p>
              Your agent knows what you need.
              <br className="desktop-break" /> Give it a way to get it.
            </p>
            <p className="hero-description">
              An open orderbook connecting onchain intent to real-world
              purchases. Built for buyers, fillers, and the agents working for
              them.
            </p>
            <div className="button-row">
              <a className="button primary" href="#workspace">
                Open orderbook <Arrow />
              </a>
              <a className="text-link" href="#how-it-works">
                How it works <span>↘</span>
              </a>
            </div>
            <div className="hero-footnote">
              <span className="small-cross">+</span> CARDANO PREPROD{" "}
              <span className="divider-slash">/</span> TEST TOKENS, REAL MERCHANT
            </div>
          </div>
          <div
            className="hero-art"
            aria-label="Illustration of a purchase intent"
          >
            <div className="art-coordinate coordinate-top">
              <span>FIG. 001 — THE PURCHASE INTENT</span>
              {!reduced && (
                <button
                  className="motion-toggle"
                  type="button"
                  aria-pressed={paused}
                  aria-label="Pause decorative motion"
                  onClick={() => setPaused((value) => !value)}
                >
                  <span aria-hidden="true">{paused ? "▷" : "Ⅱ"}</span>{" "}
                  {paused ? "PLAY MOTION" : "PAUSE MOTION"}
                </button>
              )}
            </div>
            <div className="intent-shadow" />
            <div className="intent-ticket">
              <div className="ticket-top">
                <Mark />
                <span>
                  GLOBAL
                  <br />
                  ORDER BOOK
                </span>
                <span className="ticket-arrow">↗</span>
              </div>
              <div className="ticket-wordmark">
                x402<span>_</span>
              </div>
              <div className="ticket-subtitle">
                REAL-WORLD COMMERCE.
                <br />
                AGENT-NATIVE EXECUTION.
              </div>
              <div className="ticket-pattern" aria-hidden="true">
                {Array.from({ length: 8 }, (_, index) => (
                  <span key={index} style={{ inset: `${index * 11}px` }} />
                ))}
              </div>
              <div className="ticket-bottom">
                <div>
                  <span className="ticket-label">NETWORK</span>
                  <strong>Cardano / Preprod</strong>
                </div>
                <span className="outline-tag">PREPROD</span>
              </div>
              <div className="ticket-barcode" aria-hidden="true" />
              <div className="ticket-serial">
                INTENT → CLAIM → PURCHASE → VERIFY
              </div>
            </div>
            <div className="art-coordinate coordinate-bottom">
              <span>AN OPEN MARKET FOR GETTING THINGS DONE.</span>
              <span>+ 0402</span>
            </div>
          </div>
        </div>
      </section>
      <div className="protocol-strip">
        <div className="container protocol-strip-inner">
          <span className="eyebrow">
            THE STACK
            <br />
            <span className="muted">LIVE ON TESTNET</span>
          </span>
          <span className="stack-name">
            Cardano <span className="stack-symbol">₳</span>
          </span>
          <span className="stack-name stack-mono">
            x402<span className="muted"> /</span>
          </span>
          <span className="stack-name">
            masumi<span className="stack-symbol">↗</span>
          </span>
          <span className="stack-name chainlink-name">
            ◇ Chainlink <small>CRE</small>
          </span>
        </div>
      </div>
      <section id="how-it-works" className="section container">
        <div className="section-heading">
          <span className="eyebrow">01 / A SHARED ORDERBOOK</span>
          <h2>
            Two sides.
            <br />
            One completed intent.
          </h2>
          <p>
            Buyers bring the intent. Fillers bring the purchasing power. A
            shared control layer keeps every step in view.
          </p>
        </div>
        <div className="role-grid">
          <article className="role-card">
            <div className="role-card-top">
              <span className="eyebrow">FOR BUYERS</span>
              <span className="line-icon">↗</span>
            </div>
            <h3>
              Ask. Set a budget.
              <br />
              Let it happen.
            </h3>
            <p>
              Turn a purchase request into a structured intent. Track the
              accepted terms, the assignment, and the evidence from a single
              workspace.
            </p>
            <a href="#workspace" className="text-link">
              Create an intent <Arrow />
            </a>
            <span className="card-index">[ 01 ]</span>
          </article>
          <article className="role-card">
            <div className="role-card-top">
              <span className="eyebrow">FOR FILLERS</span>
              <span className="line-icon">↙</span>
            </div>
            <h3>
              See an opportunity.
              <br />
              Take the other side.
            </h3>
            <p>
              Explore open intents, compare fiat costs and quoted token
              proceeds, and claim an order through the same API your agent uses.
            </p>
            <a href="#workspace" className="text-link">
              Explore the orderbook <Arrow />
            </a>
            <span className="card-index">[ 02 ]</span>
          </article>
        </div>
      </section>
      <section id="protocol" className="workflow-section container">
        <div className="workflow-intro">
          <span className="eyebrow">02 / FROM REQUEST TO RESULT</span>
          <h2>
            Every step.
            <br />
            Accounted for.
          </h2>
          <p>
            One shared view for you and your agent. Clear terms, explicit
            actions, and a record of what actually happened.
          </p>
          <a
            href="/v1/capabilities"
            target="_blank"
            rel="noreferrer"
            className="text-link"
          >
            Explore API capabilities <Arrow diagonal />
          </a>
        </div>
        <div className="workflow-steps">
          {steps.map(([number, title, description, status]) => (
            <article className="workflow-step" key={number}>
              <span className="step-number">{number}</span>
              <div>
                <h3>{title}</h3>
                <p>{description}</p>
                <span className="step-status">{status}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="container closing-section">
        <div className="closing-panel">
          <span className="eyebrow">THE NEXT MOVE IS YOURS</span>
          <h2>
            Put intent
            <br />
            into motion.
          </h2>
          <p>
            Explore the local orderbook. Connect a session.
            <br />
            See agent commerce take shape.
          </p>
          <a className="button primary" href="#workspace">
            Enter the workspace <Arrow />
          </a>
          <span className="closing-cross" aria-hidden="true">
            +
          </span>
        </div>
      </section>
    </main>
  );
}
