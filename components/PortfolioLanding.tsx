"use client";

import type { MouseEvent } from "react";
import { useEffect, useState } from "react";
import { TrackerApp } from "@/components/TrackerApp";

type TourStep = {
  title: string;
  location: string;
  input: string;
  result: string;
};

type InputGuideSection = {
  title: string;
  purpose: string;
  items: Array<{ label: string; help: string }>;
};

const productStats = [
  { value: "10+", label: "supported input families" },
  { value: "100%", label: "user-controlled backup flow" },
  { value: "INR", label: "base analytics with USD context" },
  { value: "0", label: "account connection required" }
];

const featureChips = [
  "Privacy-first",
  "No sign-up",
  "Backup export",
  "CAS PDF import",
  "Broker files",
  "XIRR",
  "Goals",
  "Expenses",
  "Tax estimates",
  "Snapshots"
];

const startPath = [
  {
    title: "Open Vaultfolio",
    text: "Enter the workspace. You can start with data first; Settings can wait until you need planning, tax, or display controls."
  },
  {
    title: "Add your data",
    text: "Use supported imports, manual entries, manual CSV templates, or a restored JSON backup. The tool does not guess unknown financial formats."
  },
  {
    title: "Review your portfolio",
    text: "Check holdings, transactions, invested amount, current value, source quality, and market-data coverage before relying on insights."
  },
  {
    title: "Explore insights",
    text: "Use analytics, goals, expenses, tax, snapshots, and planning once the portfolio values look right."
  }
];

const setupTracks = [
  {
    title: "Goals and planning",
    tone: "Optional depth",
    points: ["Create goals", "Map holdings", "Tune assumptions in Settings", "Review readiness, gaps, and drawdown"]
  },
  {
    title: "Expense model",
    tone: "When goals need spending detail",
    points: ["Import expense CSVs", "Choose active scenarios", "Separate current spend from planning spend", "Feed goal corpus from traceable rows"]
  },
  {
    title: "Tax and audit",
    tone: "When tax estimates matter",
    points: ["Set slab and surcharge", "Review FIFO lots", "Use FMV only where tax needs it", "Keep portfolio math separate from tax assumptions"]
  },
  {
    title: "Snapshots and backup",
    tone: "Recommended safety layer",
    points: ["Capture snapshots at important points", "Export JSON after meaningful changes", "Restore saved states later", "Refresh market data only when you choose"]
  }
];

const advancedKnobs = [
  { name: "Tax profile", detail: "Changes portfolio tax estimates, realized lot audit, and taxable income calculations." },
  { name: "Display currency", detail: "Adds USD equivalents under INR values without changing INR base calculations." },
  { name: "Goal assumptions", detail: "Controls target corpus, needed-today corpus, projections, drawdown, and glidepath." },
  { name: "Expense scenarios", detail: "Lets current spending stay separate from the scenario used for goal math." },
  { name: "Taper mode", detail: "Applies planning-only conservative value to selected holdings while actual/tax values stay factual." },
  { name: "Cash-flow planning", detail: "Tests future monthly contributions without creating real transactions." },
  { name: "Snapshots", detail: "Freezes analytics so old states can be reconstructed without new market fetches." },
  { name: "Replace import", detail: "Refreshes a source file while preserving matching user edits, mappings, FMV, and taper settings." }
];

const capabilityCards = [
  {
    title: "Bring your own data",
    detail: "Use CAS PDFs, broker exports, PF/NPS statements, manual ledgers, expense CSVs, manual entries, or a restored JSON backup."
  },
  {
    title: "Audit the portfolio",
    detail: "Review current value, cost basis, P/L, XIRR, allocation, concentration, current price, transaction history, and data quality from one workspace."
  },
  {
    title: "Plan goal funding",
    detail: "Create goals, map holdings, compare corpus needed today with projected corpus, and model drawdown longevity with explicit assumptions."
  },
  {
    title: "Connect expenses to goals",
    detail: "Import detailed expense rows, choose the scenario that feeds each goal, and keep current spending analytics separate from planning assumptions."
  },
  {
    title: "Estimate Indian portfolio tax",
    detail: "Inspect realized and unrealized gains, FIFO lots, tax buckets, FMV tax price, portfolio income, and assumptions used for estimates."
  },
  {
    title: "Keep a frozen record",
    detail: "Capture snapshots and export JSON so old states can be reconstructed later without market refresh changing the story."
  }
];

const supportedInputs = [
  { name: "CAS PDF", detail: "CAMS/KFintech mutual fund statements. Passwords are used in-browser only when needed to read encrypted PDFs." },
  { name: "INDMoney export", detail: "Known stock export layouts for Indian and US positions, trades, prices, and dividends where available." },
  { name: "Fidelity/manual stock CSV", detail: "Buy/sell rows with quantity, actual price, FX, fees, taxes, notes, and optional tax-only FMV." },
  { name: "Groww stock order history", detail: "Known Groww CSV/XLSX order-history layout for Indian stock transactions." },
  { name: "Zerodha tradebook", detail: "Known tradebook CSV layout with symbol, ISIN, trade date, quantity, price, and buy/sell type." },
  { name: "PF/EPFO passbook", detail: "Employee and employer contributions, interest, and balance rows for PF reconstruction." },
  { name: "NPS statement", detail: "Contribution, unit, and NAV rows for invested amount, units, valuation, and XIRR." },
  { name: "Manual ledger CSV", detail: "PPF, SSY, ESPP, cash, FD/manual assets, interest/accruals, balances, and custom rows." },
  { name: "Expense CSV", detail: "Goal expense rows with scenarios, categories, payer, frequency, base date, and notes." },
  { name: "Backup JSON", detail: "Complete restore point for a previously exported portfolio workspace, including imported records, edits, goals, expenses, settings, and snapshots." }
];

const tourSteps: TourStep[] = [
  {
    title: "Add your first data source",
    location: "Open Vaultfolio > Imports or Add Entry",
    input: "Start with a supported import, manual CSV, manual entry, or restored JSON backup.",
    result: "A new workspace starts from trusted source data, not from a mandatory setup wizard."
  },
  {
    title: "Review the import result",
    location: "Imports preview",
    input: "Check detected file type, parsed rows, rejected rows, and before/after impact where available.",
    result: "You know what will enter the portfolio before relying on the numbers."
  },
  {
    title: "Refresh intentionally",
    location: "Refresh",
    input: "Press Refresh when you want current NAV, stock quotes, or FX.",
    result: "Restored JSON stays frozen until you explicitly ask for current market data."
  },
  {
    title: "Review holdings",
    location: "Holdings",
    input: "Search, sort, open details, or enter edit mode for visible holding fields.",
    result: "Value, price, invested amount, P/L, XIRR, tracked value, and transactions are visible."
  },
  {
    title: "Read scoped analytics",
    location: "Overview",
    input: "Choose overall portfolio, combined goals, or one goal as the analytics scope.",
    result: "Allocation, returns, risk, history, and concentration match the chosen scope."
  },
  {
    title: "Plan goals",
    location: "Goals and Settings",
    input: "Add goals, configure assumptions, map holdings, and choose included goals.",
    result: "Readiness, corpus needed today, projection, and goal-specific analytics update."
  },
  {
    title: "Model expenses",
    location: "Expenses and Settings",
    input: "Import line-item expense CSVs and select the scenario used for goal math.",
    result: "Goal expense, target corpus, and longevity use a traceable expense model."
  },
  {
    title: "Estimate tax",
    location: "Tax",
    input: "Set tax profile and review realized sales, open lots, FMV, and income rows.",
    result: "Tax estimates show assumptions, FIFO trace, bucket set-off, and audit rows."
  },
  {
    title: "Snapshot and export",
    location: "Snapshots and Export",
    input: "Capture a snapshot and export JSON after important changes.",
    result: "You keep a portable backup and a frozen historical timeline."
  }
];

function scrollLandingTop() {
  const reset = () => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: "auto" });
  };
  requestAnimationFrame(reset);
  window.setTimeout(reset, 0);
  window.setTimeout(reset, 80);
  window.setTimeout(reset, 180);
    window.setTimeout(reset, 400);
}

const inputGuide: InputGuideSection[] = [
  {
    title: "Imports",
    purpose: "Use imports when downloaded files or CSV templates are the source of truth.",
    items: [
      { label: "Import label", help: "Names the file or batch so source data can be audited later." },
      { label: "Replace existing import", help: "Use when a newer file supersedes an older one. Matching user edits are preserved where records can be matched safely." },
      { label: "CAS password", help: "Used only in the browser to read encrypted CAS PDFs. It is not part of portfolio analytics." },
      { label: "Manual CSV text/file", help: "Paste or upload rows that match committed templates for balances, transactions, expenses, or FX." },
      { label: "Expense base date", help: "Date from which expense amounts are inflated to today and to each goal year." },
      { label: "Fallback goal", help: "Used only when an expense CSV does not contain a goal column." }
    ]
  },
  {
    title: "Manual Entry",
    purpose: "Use this for one-off records when re-importing a whole file is unnecessary.",
    items: [
      { label: "Asset/action", help: "Controls valid fields for buy, sell, contribution, interest, withdrawal, balance, and custom rows." },
      { label: "Date", help: "Affects XIRR, cost basis, history, tax, goals, and drawdown calculations." },
      { label: "Amount", help: "Cash value of the row. For unitized assets it may be derived from quantity times price." },
      { label: "Quantity/units", help: "Required when stocks, mutual funds, NPS, or other unitized assets change units." },
      { label: "Price/NAV", help: "Per-unit value used for the manual action and optional price snapshot." },
      { label: "Fees/taxes", help: "Stored separately so audit and tax views can distinguish investment amount from charges." }
    ]
  },
  {
    title: "Holdings Edit",
    purpose: "Use edit mode for visible holding fields. Analytics refresh once editing is done.",
    items: [
      { label: "Name/category", help: "Controls display name and grouping across analytics, goals, tax, and allocation." },
      { label: "Current value", help: "Latest actual value. It drives net worth unless market refresh updates it." },
      { label: "Quantity and price", help: "Used to derive value and show current per-unit or per-share price." },
      { label: "Invested amount", help: "Cost basis fallback when transactions cannot fully reconstruct cost." },
      { label: "Taper mode", help: "Planning-only conservative tracked value. Actual value and tax stay untapered." }
    ]
  },
  {
    title: "Transactions Edit",
    purpose: "Transaction corrections affect XIRR, cost basis, tax, history, and source audit.",
    items: [
      { label: "Type", help: "Buy, sell, contribution, interest, dividend, tax, and fee types drive different engines." },
      { label: "Actual price", help: "Used for portfolio math, invested value, P/L, and XIRR." },
      { label: "FMV/tax price", help: "Optional fair market value per unit in transaction currency. Tax uses it; portfolio math does not." },
      { label: "FX rate", help: "Transaction-date FX powers INR analytics when available." },
      { label: "Fees and taxes", help: "Kept separate for transaction audit and tax visibility." }
    ]
  },
  {
    title: "Goals",
    purpose: "Goals convert the portfolio from net-worth tracking into purpose-based planning.",
    items: [
      { label: "Goal name/type", help: "Planning identity such as retirement, education, home, or custom." },
      { label: "Target year", help: "Year the corpus is needed; controls projection horizon and readiness." },
      { label: "Monthly expense", help: "Manual starting value unless an included expense scenario supplies the goal expense." },
      { label: "Inflation", help: "Inflates current expenses to the goal year." },
      { label: "Corpus multiple", help: "Target corpus is first-year annual expense times this multiple." },
      { label: "Return assumptions", help: "Equity, debt, cash, gold, and other rates project mapped assets." },
      { label: "Include in combined goals", help: "Excluded goals remain individual but do not inflate combined totals." },
      { label: "Asset mapping percent", help: "Maps part or all of a holding to a goal for goal-specific analytics." }
    ]
  },
  {
    title: "Expenses",
    purpose: "Expenses replace manual goal expense inputs with traceable line items and scenarios.",
    items: [
      { label: "Scenario", help: "A spending version such as Current, Retirement, Bare Minimum, or any custom label." },
      { label: "Active scenario", help: "The scenario selected to feed goal corpus and longevity math." },
      { label: "Category/subcategory/item", help: "Controls grouping and drilldown in expense analytics." },
      { label: "Amount or quantity", help: "Enter direct amount or let quantity times unit amount calculate the row." },
      { label: "Frequency", help: "Monthly rows count as-is; yearly rows are divided by 12." },
      { label: "Payer", help: "Used for current payer responsibility; it does not change holdings." },
      { label: "Include in expense totals", help: "Controls household expense analytics while preserving goal-specific rows." }
    ]
  },
  {
    title: "Settings",
    purpose: "Settings are primary inputs for tax, display, planning, allocation, cash-flow, and goal assumptions.",
    items: [
      { label: "Tax regime/slab/surcharge/cess", help: "Used for Indian resident portfolio tax estimates. This is not an ITR filing engine." },
      { label: "Show USD equivalents", help: "Display-only secondary values. INR remains the base analytics currency." },
      { label: "Return assumptions", help: "Asset-class return rates power planning scenarios and goal projections." },
      { label: "Scenario shocks", help: "Inflation, equity correction, and USD-INR assumptions support what-if planning only." },
      { label: "Portfolio target allocation", help: "Used for advisory rebalancing at portfolio level." },
      { label: "Monthly investable surplus", help: "Optional future contribution amount for planning. It does not create transactions." },
      { label: "Contribution timing", help: "Controls when planned contributions start and how long they continue." },
      { label: "Goal settings", help: "Central place for expense source, inclusion, phase allocation, drawdown, and glide path." }
    ]
  },
  {
    title: "Backup and restore",
    purpose: "This is the safety layer for a privacy-first workflow.",
    items: [
      { label: "Snapshot name/notes", help: "Stores a frozen analytics state for later comparison without fresh market fetch." },
      { label: "Export JSON", help: "The complete portable backup. Export after important imports, edits, settings, expenses, goals, and snapshots." },
      { label: "Restore JSON", help: "Restores the saved state by design. Press Refresh only when you want current market data." }
    ]
  }
];

export function PortfolioLanding() {
  const initialShowTool = typeof window !== "undefined" && window.location.hash === "#tool";
  const [showTool, setShowTool] = useState(() => initialShowTool);
  const [toolMounted, setToolMounted] = useState(() => initialShowTool);

  useEffect(() => {
    scrollLandingTop();
  }, [showTool]);

  useEffect(() => {
    const syncRoute = () => {
      const nextShowTool = window.location.hash === "#tool";
      setShowTool(nextShowTool);
      if (nextShowTool) {
        setToolMounted(true);
        scrollLandingTop();
      }
    };
    syncRoute();
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);

  function openTool(event?: MouseEvent<HTMLAnchorElement | HTMLButtonElement>) {
    event?.preventDefault();
    window.location.hash = "tool";
    setToolMounted(true);
    setShowTool(true);
    scrollLandingTop();
  }

  function returnToHome() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    history.pushState(null, "", window.location.pathname + window.location.search);
    setShowTool(false);
    scrollLandingTop();
  }

  return (
    <>
      <main className="landing-page" hidden={showTool} aria-hidden={showTool}>
      <header className="landing-nav">
        <a className="landing-brand" href="#top" aria-label="Vaultfolio home page">
          <span>Vaultfolio</span>
          <small>Privacy-first portfolio planner</small>
        </a>
        <nav aria-label="Product navigation">
          <a href="#start">Start</a>
          <a href="#tour">Tour</a>
          <a href="#imports">Formats</a>
          <a href="#inputs">Input guide</a>
          <a href="#privacy">Privacy</a>
          <a className="landing-nav-button" href="#tool" onClick={openTool}>Open Vaultfolio</a>
        </nav>
      </header>

      <section className="landing-hero" id="top">
        <div className="landing-hero-copy">
          <span className="landing-eyebrow">Vaultfolio · privacy-first portfolio planner</span>
          <h1>Understand your money without surrendering your data.</h1>
          <p>Vaultfolio helps you import your own files, inspect the numbers, plan goals, model expenses, estimate taxes, capture snapshots, and export a complete backup. The workflow is built for Indian investors who want control, auditability, and a clear path back to source data.</p>
          <div className="landing-actions">
            <a className="landing-primary-button" href="#tool" onClick={openTool}>Open Vaultfolio</a>
            <a className="landing-secondary-button" href="#tour">Take the Tour</a>
            <a className="landing-text-link" href="#inputs">Review Inputs</a>
          </div>
          <div className="landing-stat-strip" aria-label="Product highlights">
            {productStats.map((stat) => <div key={stat.label}><strong>{stat.value}</strong><span>{stat.label}</span></div>)}
          </div>
          <div className="landing-chip-row" aria-label="Key capabilities">
            {featureChips.map((chip) => <span key={chip}>{chip}</span>)}
          </div>
        </div>
        <div className="landing-product-showcase" aria-label="Vaultfolio workspace preview">
          <figure className="landing-screenshot-frame landing-screenshot-main">
            <div className="showcase-topbar"><span /><span /><span /><strong>Sample overview</strong></div>
            <img src="/landing/overview-preview.png" alt="Sample portfolio overview screen" />
            <figcaption>Sample-data preview of the Vaultfolio workspace.</figcaption>
          </figure>
          <figure className="landing-screenshot-frame landing-screenshot-side">
            <div className="showcase-topbar"><strong>Holdings analytics</strong></div>
            <img src="/landing/holdings-preview.png" alt="Sample holdings analytics screen" />
          </figure>
        </div>
      </section>

      <section className="landing-section landing-start-path" id="start">
        <div className="landing-section-head split-head">
          <div>
            <span className="landing-eyebrow">Get started</span>
            <h2>Build the workspace from your data, then add depth when you need it.</h2>
          </div>
          <p>New users can begin with imports, manual entries, or CSV templates. Returning users can restore a JSON backup and continue from the saved state.</p>
        </div>
        <div className="landing-path-grid">
          {startPath.map((step, index) => (
            <article className="landing-path-card" key={step.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </article>
          ))}
        </div>
        <div className="landing-start-callouts">
          <div className="landing-backup-note">
            <strong>Already have a backup?</strong>
            <span>Restore JSON from Backup or Imports. The workspace intentionally shows saved values until you refresh market data.</span>
          </div>
          <div className="landing-backup-note">
            <strong>Recommended safety step</strong>
            <span>Export JSON after meaningful imports, edits, settings, goals, expenses, or snapshots. It is your portable backup for this privacy-first workflow.</span>
          </div>
        </div>
        <div className="onboarding-flow-grid" aria-label="Setup paths">
          {setupTracks.map((track) => (
            <article className="onboarding-flow-card" key={track.title}>
              <span>{track.tone}</span>
              <h3>{track.title}</h3>
              <ul>{track.points.map((point) => <li key={point}>{point}</li>)}</ul>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section onboarding-knobs-section" id="knobs">
        <div className="landing-section-head split-head">
          <div>
            <span className="landing-eyebrow">Advanced controls</span>
            <h2>Every setting has a purpose. Use advanced controls after the base portfolio is right.</h2>
          </div>
          <p>Settings explain what each input changes. Actual value, tax-only value, planning value, and backup state stay deliberately separate.</p>
        </div>
        <div className="advanced-knob-grid">
          {advancedKnobs.map((knob) => <article className="advanced-knob-card" key={knob.name}><strong>{knob.name}</strong><p>{knob.detail}</p></article>)}
        </div>
      </section>

      <section className="landing-section landing-capabilities" id="features">
        <div className="landing-section-head">
          <span className="landing-eyebrow">What it does</span>
          <h2>A professional workspace for portfolio decisions.</h2>
          <p>The front page explains the workflow; the portfolio app remains the dense working area for actual analysis.</p>
        </div>
        <div className="landing-card-grid">
          {capabilityCards.map((card) => <article className="landing-card" key={card.title}><h3>{card.title}</h3><p>{card.detail}</p></article>)}
        </div>
      </section>

      <section className="landing-section landing-tour" id="tour">
        <div className="landing-section-head split-head">
          <div>
            <span className="landing-eyebrow">Product tour</span>
            <h2>From first data source to trusted portfolio insight.</h2>
          </div>
          <p>The tour uses the same page names as the app, so a user can move from explanation to action without guessing where something belongs.</p>
        </div>
        <div className="tour-list">
          {tourSteps.map((step, index) => (
            <article className="tour-step" key={step.title}>
              <div className="tour-index">{String(index + 1).padStart(2, "0")}</div>
              <div>
                <h3>{step.title}</h3>
                <dl>
                  <div><dt>Where</dt><dd>{step.location}</dd></div>
                  <div><dt>Input</dt><dd>{step.input}</dd></div>
                  <div><dt>Result</dt><dd>{step.result}</dd></div>
                </dl>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section" id="imports">
        <div className="landing-section-head split-head">
          <div>
            <span className="landing-eyebrow">Supported inputs</span>
            <h2>Known formats only. No silent guessing.</h2>
          </div>
          <p>For financial data, wrong parsing is worse than no parsing. The tool accepts known formats and asks for a valid template when the file is unknown.</p>
        </div>
        <div className="input-support-grid">
          {supportedInputs.map((item) => <article className="input-support-card" key={item.name}><h3>{item.name}</h3><p>{item.detail}</p></article>)}
        </div>
      </section>

      <section className="landing-section input-guide-section" id="inputs">
        <div className="landing-section-head split-head">
          <div>
            <span className="landing-eyebrow">Input guide</span>
            <h2>Know what every input changes.</h2>
          </div>
          <p>Actual value, tax-only value, planning-only value, and backup state are intentionally different concepts. This guide makes those boundaries explicit.</p>
        </div>
        <div className="input-guide-grid">
          {inputGuide.map((section) => (
            <details className="input-guide-card" key={section.title}>
              <summary><span>{section.title}</span><small>{section.purpose}</small></summary>
              <div className="input-guide-body">
                {section.items.map((item) => <div className="input-guide-row" key={item.label}><strong>{item.label}</strong><p>{item.help}</p></div>)}
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="landing-section privacy-section" id="privacy">
        <div className="privacy-copy">
          <span className="landing-eyebrow">Privacy model</span>
          <h2>Your backup is the product boundary.</h2>
          <p>This is a privacy-first workflow: keep source files with you, restore JSON when needed, refresh market data only when you choose, and export after meaningful changes.</p>
          <a className="landing-primary-button" href="#tool" onClick={openTool}>Open Vaultfolio</a>
        </div>
        <div className="privacy-points">
          <div><strong>No account required</strong><span>The current tool does not need login, account linking, or cloud sync.</span></div>
          <div><strong>Browser workspace</strong><span>Portfolio records stay in browser storage until you reset or restore.</span></div>
          <div><strong>Portable JSON</strong><span>Export JSON to move devices or preserve a point-in-time state.</span></div>
          <div><strong>Explicit refresh</strong><span>Restored JSON shows saved values until you ask for current NAV, quotes, and FX.</span></div>
        </div>
      </section>

      <section className="landing-final-cta">
        <span className="landing-eyebrow">Ready to work</span>
        <h2>Open Vaultfolio, add your data, and review the numbers.</h2>
        <p>The home page stays available from inside the workspace whenever you need the tour, supported formats, or input guide again.</p>
        <a className="landing-primary-button" href="#tool" onClick={openTool}>Open Vaultfolio</a>
      </section>
      </main>
      {toolMounted && (
        <div className="landing-tool-shell" hidden={!showTool} aria-hidden={!showTool}>
          <TrackerApp onReturnHome={returnToHome} />
        </div>
      )}
    </>
  );
}
