import { useEffect, useState } from "react";
import { Landing } from "./Landing";
import { Workspace } from "./Workspace";
import { Arrow, Mark } from "./ui";

export function App() {
  const [workspace, setWorkspace] = useState(
    location.hash.startsWith("#workspace"),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const navigate = () => {
      const next = location.hash.startsWith("#workspace");
      setWorkspace(next);
      setMenuOpen(false);
      if (next || !location.hash) window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  useEffect(() => {
    if (!workspace && location.hash && location.hash !== "#") {
      document.getElementById(location.hash.slice(1))?.scrollIntoView();
    }
  }, [workspace]);
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner container">
          <a className="brand" href="#" aria-label="Global Order Book home">
            <Mark />
            <span>
              GLOBAL<span className="brand-secondary">ORDER BOOK</span>
            </span>
            <span className="brand-version">/ x402</span>
          </a>
          <nav
            className={menuOpen ? "navigation is-open" : "navigation"}
            aria-label="Main navigation"
          >
            <a href="#how-it-works">How it works</a>
            <a href="#protocol">The protocol</a>
            <a href="/v1/capabilities" target="_blank" rel="noreferrer">
              API <Arrow diagonal />
            </a>
          </nav>
          <a
            className="button primary header-cta"
            href={workspace ? "#" : "#workspace"}
          >
            {workspace ? "Back to overview" : "Launch app"} <Arrow diagonal />
          </a>
          <button
            className="menu-button icon-button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? "×" : "☰"}
          </button>
        </div>
      </header>
      {workspace ? <Workspace /> : <Landing />}
      <footer className="site-footer container">
        <a className="footer-brand" href="#">
          <Mark />
          <span>GLOBAL ORDER BOOK</span>
        </a>
        <span>Built for the agents. Made for the real world.</span>
        <span className="footer-meta">
          CARDANO PREPROD <span>© {new Date().getFullYear()}</span>
        </span>
      </footer>
    </>
  );
}
