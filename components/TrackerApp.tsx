"use client";

import { Download, FileJson, LayoutDashboard, Pencil, RefreshCw, RotateCcw, Save, Search, Table2, Upload, X } from "lucide-react";
import { useMemo, useState } from "react";
import { calculatePortfolioInsights, calculatePortfolioSummary } from "@/src/domain/analytics";
import { detectImportSource, type ImportDetection } from "@/src/importers/detectImport";
import { extractPdfTextInBrowser } from "@/src/importers/browserPdfText";
import { applyCanonicalCasImport, buildCanonicalCasImport, parseCasText, type CasCanonicalImport, type CasParseResult } from "@/src/importers/casText";
import { applyCanonicalIndMoneyImport, buildCanonicalIndMoneyImport, parseIndMoneyWorkbook, type IndMoneyCanonicalImport, type IndMoneyParseResult } from "@/src/importers/indmoneyXlsx";
import { commitManualCsvImport } from "@/src/importers/importPipeline";
import { providerImportSpecs } from "@/src/importers/providerRegistry";
import { applyMarketDataPayload, type MarketDataPayload } from "@/src/marketData/marketData";
import { buildUsdInrSnapshot, mergePriceSnapshots, parseUsdInrFxCsv } from "@/src/marketData/manualFx";
import { createEmptyBackup, parseBackup, type AssetCategory, type ManualBalance, type PortfolioBackup, type Transaction } from "@/src/schema/backup";

const sampleTemplate = `account_name,asset_name,asset_type,category,currency,current_value,as_of_date,notes\nCash Wallet,Cash Wallet,cash,Cash,INR,10000,2026-06-22,liquid cash\nEmployer ESPP,ESPP Contribution,espp,Equity,USD,2000,2026-06-22,total contribution\nPPF,Public Provident Fund,ppf,Debt,INR,300000,2026-06-22,manual balance`;

const categoryOrder: AssetCategory[] = ["Equity", "Debt", "Gold", "Others", "Cash"];
const transactionTypes: Transaction["type"][] = ["buy", "sell", "sip", "redemption", "switch_in", "switch_out", "dividend", "interest", "deposit", "withdrawal", "fee", "tax", "maturity", "contribution", "split"];

type View = "dashboard" | "records" | "imports" | "backup";
type HoldingSort = "value" | "name" | "category" | "source";
type EditableBalance = Pick<ManualBalance, "label" | "category" | "currency" | "value" | "quantity" | "price" | "asOfDate" | "notes">;
type EditableTransaction = Pick<Transaction, "date" | "type" | "currency" | "amount" | "quantity" | "price" | "fees" | "taxes">;

export function TrackerApp() {
  const [backup, setBackup] = useState<PortfolioBackup>(() => createEmptyBackup("INR"));
  const [view, setView] = useState<View>("dashboard");
  const [csv, setCsv] = useState(sampleTemplate);
  const [errors, setErrors] = useState<string[]>([]);
  const [nativeDetection, setNativeDetection] = useState<ImportDetection | null>(null);
  const [nativeFile, setNativeFile] = useState<File | null>(null);
  const [casPassword, setCasPassword] = useState("");
  const [casParse, setCasParse] = useState<CasParseResult | null>(null);
  const [stagedCas, setStagedCas] = useState<CasCanonicalImport | null>(null);
  const [indParse, setIndParse] = useState<IndMoneyParseResult | null>(null);
  const [stagedInd, setStagedInd] = useState<IndMoneyCanonicalImport | null>(null);
  const [status, setStatus] = useState("Empty local portfolio. Import a manual CSV, CAS PDF, INDMoney XLSX, or restore a backup.");
  const [fxRate, setFxRate] = useState("");
  const [fxDate, setFxDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fxCsv, setFxCsv] = useState("date,rate\n2026-06-22,83.50");
  const [holdingQuery, setHoldingQuery] = useState("");
  const [transactionQuery, setTransactionQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<AssetCategory | "All">("All");
  const [holdingSort, setHoldingSort] = useState<HoldingSort>("value");
  const [editingBalanceId, setEditingBalanceId] = useState<string | null>(null);
  const [balanceDraft, setBalanceDraft] = useState<EditableBalance | null>(null);
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
  const [transactionDraft, setTransactionDraft] = useState<EditableTransaction | null>(null);

  const summary = useMemo(() => calculatePortfolioSummary(backup), [backup]);
  const insights = useMemo(() => calculatePortfolioInsights(backup), [backup]);
  const allocation = summary.allocation;
  const filteredHoldings = useMemo(() => {
    const q = holdingQuery.trim().toLowerCase();
    return insights.holdings
      .filter((holding) => categoryFilter === "All" || holding.category === categoryFilter)
      .filter((holding) => !q || [holding.label, holding.assetKind, holding.region, holding.provider, holding.institution, holding.issuer].join(" ").toLowerCase().includes(q))
      .sort((a, b) => {
        if (holdingSort === "name") return displayHoldingName(a.label).localeCompare(displayHoldingName(b.label));
        if (holdingSort === "category") return a.category.localeCompare(b.category) || (b.valueInBase ?? 0) - (a.valueInBase ?? 0);
        if (holdingSort === "source") return a.provider.localeCompare(b.provider) || (b.valueInBase ?? 0) - (a.valueInBase ?? 0);
        return (b.valueInBase ?? 0) - (a.valueInBase ?? 0);
      });
  }, [categoryFilter, holdingQuery, holdingSort, insights.holdings]);
  const filteredTransactions = useMemo(() => {
    const q = transactionQuery.trim().toLowerCase();
    return backup.transactions
      .filter((tx) => !q || transactionSearchText(tx, backup).includes(q))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [backup, transactionQuery]);
  const largestHolding = insights.holdings[0];
  const topFiveValue = insights.holdings.slice(0, 5).reduce((sum, holding) => sum + (holding.valueInBase ?? 0), 0);
  const topFivePercent = summary.netWorth === 0 ? 0 : (topFiveValue / summary.netWorth) * 100;
  const importProviders = new Set(backup.imports.map((run) => run.provider)).size;

  function importCsv() {
    const importId = `manual_${Date.now()}`;
    const result = commitManualCsvImport(backup, csv, { importId, fileName: "manual-template.csv" });
    setBackup(result.backup);
    setErrors(result.errors.map((error) => `Row ${error.row}: ${error.message}`));
    setStatus(`Import complete: ${result.addedBalances} added, ${result.skippedDuplicates} duplicate(s) skipped.`);
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify({ ...backup, exportedAt: new Date().toISOString() }, null, 2)], {
      type: "application/json"
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "portfolio-tracker-backup-v1.json";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function restoreBackup(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = parseBackup(JSON.parse(await file.text()));
      setBackup(parsed);
      setErrors([]);
      setStatus(`Restored ${parsed.manualBalances.length} balance record(s) from backup.`);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Invalid backup file"]);
    }
  }

  async function inspectNativeFile(file: File | undefined) {
    if (!file) return;
    setNativeFile(file);
    setCasParse(null);
    setStagedCas(null);
    setIndParse(null);
    setStagedInd(null);
    const lowerName = file.name.toLowerCase();
    const canReadText = lowerName.endsWith(".csv") || lowerName.endsWith(".json") || lowerName.endsWith(".html") || lowerName.endsWith(".txt");
    const textSample = canReadText ? (await file.text()).slice(0, 20000) : "";
    const detection = detectImportSource({ fileName: file.name, mimeType: file.type, textSample });
    setNativeDetection(detection);

    if (detection.providerId === "cas_pdf") {
      setStatus(`${detection.label}: enter the PDF password and parse in browser.`);
    } else if (detection.providerId === "indmoney_export") {
      setStatus(`${detection.label}: parse the XLSX ledger in browser.`);
    } else if (detection.status === "implemented") {
      setStatus(`${detection.label}: implemented import path detected.`);
    } else {
      setStatus(`${detection.label}: native file detected, parser not implemented yet.`);
    }
  }

  async function parseCasPdfInBrowser() {
    if (!nativeFile) {
      setErrors(["Select a CAS PDF first."]);
      return;
    }
    setErrors([]);
    setStatus("Extracting CAS PDF text in browser...");

    try {
      const text = await extractPdfTextInBrowser(nativeFile, casPassword || undefined);
      const parsed = parseCasText(text);
      const imported = buildCanonicalCasImport(parsed, {
        importId: `cas_${Date.now()}`,
        fileName: nativeFile.name
      });
      setCasParse(parsed);
      setStagedCas(imported);

      if (parsed.errors.length > 0) {
        setErrors(parsed.errors);
        setStatus(`CAS parsed with ${parsed.errors.length} error(s).`);
      } else {
        setStatus(`CAS staged: ${parsed.schemes.length} schemes, ${imported.transactions.length} transactions, ${imported.manualBalances.length} balances.`);
      }
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Unable to parse CAS PDF"]);
      setStatus("CAS PDF import failed.");
    }
  }

  async function parseIndMoneyXlsxInBrowser() {
    if (!nativeFile) {
      setErrors(["Select an INDMoney XLSX first."]);
      return;
    }
    setErrors([]);
    setStatus("Parsing INDMoney XLSX in browser...");

    try {
      const parsed = await parseIndMoneyWorkbook(nativeFile);
      const imported = buildCanonicalIndMoneyImport(parsed, {
        importId: `indmoney_${Date.now()}`,
        fileName: nativeFile.name
      });
      setIndParse(parsed);
      setStagedInd(imported);
      setErrors([...parsed.errors, ...parsed.warnings]);
      if (parsed.errors.length > 0) {
        setStatus(`INDMoney parsed with ${parsed.errors.length} error(s).`);
      } else {
        setStatus(`INDMoney staged: ${parsed.canonicalRows.length} rows, ${parsed.positions.length} open positions, ${imported.transactions.length} transactions.`);
      }
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Unable to parse INDMoney XLSX"]);
      setStatus("INDMoney XLSX import failed.");
    }
  }

  async function commitStagedCas() {
    if (!stagedCas) return;
    const next = applyCanonicalCasImport(backup, stagedCas);
    setBackup(next);
    setErrors([]);
    setStagedCas(null);
    await refreshMarketDataFor(next, `CAS committed: ${stagedCas.transactions.length} transactions and ${stagedCas.manualBalances.length} balances added.`);
  }

  async function commitStagedIndMoney() {
    if (!stagedInd) return;
    const next = applyCanonicalIndMoneyImport(backup, stagedInd);
    setBackup(next);
    setErrors([]);
    setStagedInd(null);
    await refreshMarketDataFor(next, `INDMoney committed: ${stagedInd.transactions.length} transactions and ${stagedInd.manualBalances.length} balances added.`);
  }

  async function refreshMarketData() {
    await refreshMarketDataFor(backup);
  }

  async function refreshMarketDataFor(portfolio: PortfolioBackup, prefix?: string) {
    const isins = portfolio.instruments.map((instrument) => instrument.isin).filter((isin): isin is string => Boolean(isin));
    const symbols = portfolio.instruments
      .filter((instrument) => instrument.type === "us_stock" && instrument.symbol)
      .map((instrument) => instrument.symbol as string);
    const fxDates = [
      ...portfolio.transactions.filter((tx) => tx.currency === "USD").map((tx) => tx.date),
      ...portfolio.manualBalances.filter((balance) => balance.currency === "USD").map((balance) => balance.asOfDate)
    ].filter(Boolean).sort();

    if (isins.length === 0 && symbols.length === 0 && fxDates.length === 0) {
      setStatus(prefix ?? "No mutual fund ISINs, US stock symbols, or USD cash flows available for market refresh.");
      return;
    }

    setStatus(prefix ? prefix + " Refreshing live market data and FX..." : "Refreshing live market data and FX...");
    setErrors([]);
    const params = new URLSearchParams();
    if (isins.length > 0) params.set("isins", [...new Set(isins)].join(","));
    if (symbols.length > 0) params.set("symbols", [...new Set(symbols)].join(","));
    if (fxDates.length > 0) {
      params.set("fxStart", fxDates[0]);
      params.set("fxEnd", new Date().toISOString().slice(0, 10));
    }

    try {
      const response = await fetch("/api/market-data?" + params.toString());
      const payload = (await response.json()) as MarketDataPayload;
      setBackup(applyMarketDataPayload(portfolio, payload));
      setErrors(payload.errors);
      setStatus(
        (prefix ? prefix + " " : "") +
          `Market refresh complete: ${payload.navs.length} NAV(s), ${payload.stocks.length} US quote(s), ${(payload.fxs?.length ?? 0) + (payload.fx ? 1 : 0)} USD/INR rate(s).`
      );
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Market refresh failed"]);
      setStatus(prefix ? prefix + " Market refresh failed." : "Market refresh failed.");
    }
  }

  function applyManualFxRate() {
    try {
      const snapshot = buildUsdInrSnapshot(Number(fxRate), fxDate, "manual_fx");
      setBackup((current) => ({
        ...current,
        exportedAt: new Date().toISOString(),
        priceSnapshots: mergePriceSnapshots(current.priceSnapshots, [snapshot])
      }));
      setErrors([]);
      setStatus(`USD/INR rate added for ${snapshot.asOfDate}.`);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Invalid USD/INR rate"]);
    }
  }

  function importFxCsvText() {
    const parsed = parseUsdInrFxCsv(fxCsv);
    if (parsed.snapshots.length > 0) {
      setBackup((current) => ({
        ...current,
        exportedAt: new Date().toISOString(),
        priceSnapshots: mergePriceSnapshots(current.priceSnapshots, parsed.snapshots)
      }));
    }
    setErrors(parsed.errors);
    setStatus(`Imported ${parsed.snapshots.length} USD/INR rate(s) from CSV.`);
  }

  async function importFxCsvFile(file: File | undefined) {
    if (!file) return;
    const parsed = parseUsdInrFxCsv(await file.text());
    if (parsed.snapshots.length > 0) {
      setBackup((current) => ({
        ...current,
        exportedAt: new Date().toISOString(),
        priceSnapshots: mergePriceSnapshots(current.priceSnapshots, parsed.snapshots)
      }));
    }
    setErrors(parsed.errors);
    setStatus(`Imported ${parsed.snapshots.length} USD/INR rate(s) from ${file.name}.`);
  }

  function resetPortfolio() {
    setBackup(createEmptyBackup("INR"));
    setErrors([]);
    setStatus("Portfolio reset locally.");
  }

  function beginEditBalance(balanceId: string) {
    const balance = backup.manualBalances.find((item) => item.id === balanceId);
    if (!balance) return;
    setEditingBalanceId(balanceId);
    setBalanceDraft({
      label: balance.label,
      category: balance.category,
      currency: balance.currency,
      value: balance.value,
      quantity: balance.quantity,
      price: balance.price,
      asOfDate: balance.asOfDate,
      notes: balance.notes ?? ""
    });
    setStatus("Editing holding. Save writes to the canonical local backup model.");
  }

  function saveBalanceEdit() {
    if (!editingBalanceId || !balanceDraft) return;
    const now = new Date().toISOString();
    setBackup((current) => ({
      ...current,
      exportedAt: now,
      manualBalances: current.manualBalances.map((balance) =>
        balance.id === editingBalanceId
          ? {
              ...balance,
              ...balanceDraft,
              value: Number(balanceDraft.value),
              quantity: optionalNumber(balanceDraft.quantity),
              price: optionalNumber(balanceDraft.price),
              currency: balanceDraft.currency.toUpperCase(),
              userModified: true,
              updatedAt: now
            }
          : balance
      ),
      instruments: current.instruments.map((instrument) => {
        const edited = current.manualBalances.find((balance) => balance.id === editingBalanceId && balance.instrumentId === instrument.id);
        return edited ? { ...instrument, category: balanceDraft.category, updatedAt: now } : instrument;
      })
    }));
    setEditingBalanceId(null);
    setBalanceDraft(null);
    setStatus("Holding updated locally. Export the canonical backup to preserve this edit outside the browser.");
  }

  function beginEditTransaction(transactionId: string) {
    const tx = backup.transactions.find((item) => item.id === transactionId);
    if (!tx) return;
    setEditingTransactionId(transactionId);
    setTransactionDraft({
      date: tx.date,
      type: tx.type,
      currency: tx.currency,
      amount: tx.amount,
      quantity: tx.quantity,
      price: tx.price,
      fees: tx.fees,
      taxes: tx.taxes
    });
    setStatus("Editing transaction. Save marks the imported record as user modified.");
  }

  function saveTransactionEdit() {
    if (!editingTransactionId || !transactionDraft) return;
    const now = new Date().toISOString();
    setBackup((current) => ({
      ...current,
      exportedAt: now,
      transactions: current.transactions.map((tx) =>
        tx.id === editingTransactionId
          ? {
              ...tx,
              ...transactionDraft,
              amount: Number(transactionDraft.amount),
              quantity: optionalNumber(transactionDraft.quantity),
              price: optionalNumber(transactionDraft.price),
              fees: Number(transactionDraft.fees ?? 0),
              taxes: Number(transactionDraft.taxes ?? 0),
              currency: transactionDraft.currency.toUpperCase(),
              userModified: true,
              updatedAt: now
            }
          : tx
      )
    }));
    setEditingTransactionId(null);
    setTransactionDraft(null);
    setStatus("Transaction updated locally. Export the canonical backup to preserve this edit outside the browser.");
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Portfolio Tracker</div>
        <nav className="nav" aria-label="Primary">
          <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>
            <LayoutDashboard size={18} /> Dashboard
          </button>
          <button className={view === "records" ? "active" : ""} onClick={() => setView("records")}>
            <Table2 size={18} /> Records
          </button>
          <button className={view === "imports" ? "active" : ""} onClick={() => setView("imports")}>
            <Upload size={18} /> Imports
          </button>
          <button className={view === "backup" ? "active" : ""} onClick={() => setView("backup")}>
            <FileJson size={18} /> Backup
          </button>
        </nav>
      </aside>

      <main className="main">
        <header className="header">
          <div>
            <h1>{viewTitle(view)}</h1>
            <p>{status}</p>
          </div>
          <div className="actions">
            <button onClick={refreshMarketData} title="Refresh NAV, quotes, and FX">
              <RefreshCw size={16} /> Refresh
            </button>
            <button onClick={exportBackup} title="Export canonical JSON backup">
              <Download size={16} /> Export
            </button>
            <button onClick={resetPortfolio} title="Reset local portfolio">
              <RotateCcw size={16} /> Reset
            </button>
          </div>
        </header>

        {errors.length > 0 && <div className="error-list global-errors">{errors.map((error) => <div key={error}>{error}</div>)}</div>}

        {view === "dashboard" && (
          <section className="grid">
            <div className="grid metrics">
              <Metric label="Net Worth" value={formatMoney(summary.netWorth, backup.baseCurrency)} />
              <Metric label="Holdings" value={String(insights.holdings.length)} />
              <Metric label="Transactions" value={String(backup.transactions.length)} />
              <Metric label="Data Sources" value={String(importProviders)} />
            </div>
            {summary.missingFx.length > 0 && (
              <div className="notice">Missing FX rate(s): {summary.missingFx.join(", ")}. Refresh market data or add real USD/INR rates under Imports to include foreign-currency holdings in INR totals.</div>
            )}
            {insights.transactionStats.missingFx.length > 0 && (
              <div className="notice">INR cash-flow analytics are incomplete because transaction-date FX is missing. Import USD/INR CSV rows for the listed transaction dates.</div>
            )}

            <div className="analytics-strip">
              <MiniInsight label="Largest Holding" value={largestHolding ? displayHoldingName(largestHolding.label) : "-"} detail={largestHolding?.valueInBase === undefined ? "" : formatMoney(largestHolding.valueInBase, backup.baseCurrency)} />
              <MiniInsight label="Top 5 Concentration" value={`${topFivePercent.toFixed(1)}%`} detail={formatMoney(topFiveValue, backup.baseCurrency)} />
              <MiniInsight label="Invested" value={formatMoney(insights.transactionStats.investedBase, backup.baseCurrency)} detail="base currency cash flow" />
              <MiniInsight label="Income" value={formatMoney(insights.transactionStats.incomeBase, backup.baseCurrency)} detail="dividend, redemption, interest" />
            </div>

            <div className="grid holdings-layout">
              <div className="card wide-card holdings-card">
                <div className="section-head">
                  <div>
                    <h2>Holdings</h2>
                    <p>Compact names are shown here; hover or open edit to see and change the full record.</p>
                  </div>
                  <div className="toolbar">
                    <label className="search-box"><Search size={15} /><input value={holdingQuery} onChange={(event) => setHoldingQuery(event.target.value)} placeholder="Search holdings" /></label>
                    <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as AssetCategory | "All")}>
                      <option value="All">All categories</option>
                      {categoryOrder.map((category) => <option value={category} key={category}>{category}</option>)}
                    </select>
                    <select value={holdingSort} onChange={(event) => setHoldingSort(event.target.value as HoldingSort)}>
                      <option value="value">Sort by value</option>
                      <option value="name">Sort by name</option>
                      <option value="category">Sort by category</option>
                      <option value="source">Sort by source</option>
                    </select>
                  </div>
                </div>
                {filteredHoldings.length === 0 ? <p className="message">No holdings match the current filters.</p> : (
                  <div className="holding-list">
                    {filteredHoldings.map((holding) => <HoldingRow key={holding.id} holding={holding} baseCurrency={backup.baseCurrency} onEdit={() => beginEditBalance(holding.id)} />)}
                  </div>
                )}
              </div>
              <div className="side-stack">
                <div className="card">
                  <h2>Allocation</h2>
                  {categoryOrder.map((category) => (
                    <div className="allocation-row" key={category}>
                      <span>{category}</span>
                      <div className="bar"><div className={`fill ${category}`} style={{ width: `${allocation[category].percent}%` }} /></div>
                      <span>{allocation[category].percent.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
                <StatsCard title="By Institution / AMC" rows={insights.totalsByIssuer.map((item) => ({ label: item.name, value: formatMoney(item.value, backup.baseCurrency) }))} />
              </div>
            </div>

            <div className="grid three">
              <StatsCard title="XIRR" rows={[{ label: backup.baseCurrency + " base", value: insights.xirrBase === null ? "-" : `${insights.xirrBase.toFixed(2)}%` }, ...Object.entries(insights.xirrByCurrency).map(([currency, value]) => ({ label: currency + " local", value: value === null ? "-" : `${value.toFixed(2)}%` }))]} />
              <StatsCard title="By Asset Type" rows={insights.totalsByAssetKind.map((item) => ({ label: item.name, value: formatMoney(item.value, backup.baseCurrency) }))} />
              <StatsCard title="By Region" rows={insights.totalsByRegion.map((item) => ({ label: item.name, value: formatMoney(item.value, backup.baseCurrency) }))} />
            </div>
          </section>
        )}

        {view === "records" && (
          <section className="grid">
            <div className="grid two records-grid">
              <div className="card wide-card">
                <div className="section-head">
                  <div><h2>Editable Holdings</h2><p>Imported balances, manual balances, categories, quantities, prices, notes, and dates.</p></div>
                </div>
                <div className="record-list">
                  {backup.manualBalances.length === 0 ? <p className="message">No balances yet.</p> : backup.manualBalances.map((balance) => (
                    <div className="record-row" key={balance.id}>
                      {editingBalanceId === balance.id && balanceDraft ? (
                        <BalanceEditor draft={balanceDraft} setDraft={setBalanceDraft} onSave={saveBalanceEdit} onCancel={() => { setEditingBalanceId(null); setBalanceDraft(null); }} />
                      ) : (
                        <>
                          <div className="record-main">
                            <strong title={balance.label}>{displayHoldingName(balance.label)}</strong>
                            <span>{balance.category} · {balance.currency} · {balance.asOfDate} · {balance.source.provider ?? balance.source.type}</span>
                          </div>
                          <div className="record-value">{formatMoney(balance.value, balance.currency)}</div>
                          <button className="icon-button" onClick={() => beginEditBalance(balance.id)} title="Edit holding"><Pencil size={15} /></button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="card wide-card">
                <div className="section-head">
                  <div><h2>Transactions</h2><p>All imported transactions are searchable and editable.</p></div>
                  <label className="search-box"><Search size={15} /><input value={transactionQuery} onChange={(event) => setTransactionQuery(event.target.value)} placeholder="Search transactions" /></label>
                </div>
                <div className="transaction-list">
                  {filteredTransactions.length === 0 ? <p className="message">No transactions match the current search.</p> : filteredTransactions.slice(0, 250).map((tx) => {
                    const instrument = backup.instruments.find((item) => item.id === tx.instrumentId);
                    return (
                      <div className="transaction-row" key={tx.id}>
                        {editingTransactionId === tx.id && transactionDraft ? (
                          <TransactionEditor draft={transactionDraft} setDraft={setTransactionDraft} onSave={saveTransactionEdit} onCancel={() => { setEditingTransactionId(null); setTransactionDraft(null); }} />
                        ) : (
                          <>
                            <div className="record-main">
                              <strong>{tx.date} · {tx.type}</strong>
                              <span title={instrument?.name}>{displayHoldingName(instrument?.name ?? tx.instrumentId)} · {tx.source.provider ?? tx.source.type}</span>
                            </div>
                            <div className="record-value">{formatMoney(tx.amount, tx.currency)}</div>
                            <button className="icon-button" onClick={() => beginEditTransaction(tx.id)} title="Edit transaction"><Pencil size={15} /></button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
                {filteredTransactions.length > 250 && <p className="message">Showing latest 250 matching transactions. Narrow the search to inspect older rows.</p>}
              </div>
            </div>
          </section>
        )}

        {view === "imports" && (
          <section className="grid">
            <div className="grid two">
              <div className="card">
                <h2>Native File Intake</h2>
                <input
                  type="file"
                  accept=".json,.csv,.pdf,.html,.xlsx,application/json,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(event) => inspectNativeFile(event.target.files?.[0])}
                />
                {nativeDetection && (
                  <div className="detection">
                    <div><span>Provider</span><strong>{nativeDetection.label}</strong></div>
                    <div><span>Status</span><strong>{nativeDetection.status}</strong></div>
                    <div><span>Type</span><strong>{nativeDetection.nativeInputType}</strong></div>
                    <div><span>Confidence</span><strong>{nativeDetection.confidence}</strong></div>
                    <p>{nativeDetection.reason}</p>
                  </div>
                )}
                {nativeDetection?.providerId === "cas_pdf" && (
                  <div className="native-actions">
                    <input
                      type="password"
                      placeholder="CAS PDF password"
                      value={casPassword}
                      onChange={(event) => setCasPassword(event.target.value)}
                    />
                    <button className="primary" onClick={parseCasPdfInBrowser}>Parse CAS PDF</button>
                  </div>
                )}
                {nativeDetection?.providerId === "indmoney_export" && (
                  <div className="native-actions">
                    <button className="primary" onClick={parseIndMoneyXlsxInBrowser}>Parse INDMoney XLSX</button>
                  </div>
                )}
                {casParse && (
                  <div className="detection">
                    <div><span>Schemes</span><strong>{casParse.schemes.length}</strong></div>
                    <div><span>Dated rows</span><strong>{casParse.datedRows}</strong></div>
                    <div><span>Financial rows</span><strong>{casParse.parsedFinancialRows}</strong></div>
                    <div><span>Warnings</span><strong>{casParse.warnings.length}</strong></div>
                    {casParse.warnings.length > 0 && <p>{casParse.warnings.join("; ")}</p>}
                    <button className="primary" onClick={commitStagedCas} disabled={!stagedCas || casParse.errors.length > 0}>Commit CAS Import</button>
                  </div>
                )}
                {indParse && (
                  <div className="detection">
                    <div><span>Rows</span><strong>{indParse.rows.length}</strong></div>
                    <div><span>Canonical</span><strong>{indParse.canonicalRows.length}</strong></div>
                    <div><span>Positions</span><strong>{indParse.positions.length}</strong></div>
                    <div><span>Warnings</span><strong>{indParse.warnings.length}</strong></div>
                    <button className="primary" onClick={commitStagedIndMoney} disabled={!stagedInd || indParse.errors.length > 0}>Commit INDMoney Import</button>
                  </div>
                )}
              </div>
              <div className="card">
                <h2>Provider Support</h2>
                <div className="support-list">
                  {providerImportSpecs.map((spec) => (
                    <div className="support-row" key={spec.id}>
                      <span>{spec.label}</span>
                      <strong className={`status-pill ${spec.status}`}>{spec.status}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid two">
              <div className="card">
                <h2>USD/INR FX Rates</h2>
                <div className="native-actions">
                  <input
                    type="number"
                    step="0.0001"
                    placeholder="USD/INR rate"
                    value={fxRate}
                    onChange={(event) => setFxRate(event.target.value)}
                  />
                  <input
                    type="date"
                    value={fxDate}
                    onChange={(event) => setFxDate(event.target.value)}
                  />
                  <button className="primary" onClick={applyManualFxRate}>Add Rate</button>
                </div>
                <p className="message">Use a real USD/INR rate. Current holdings use the latest rate; transaction analytics use rates on or before each transaction date.</p>
                <input type="file" accept=".csv,text/csv" onChange={(event) => importFxCsvFile(event.target.files?.[0])} />
                <textarea value={fxCsv} onChange={(event) => setFxCsv(event.target.value)} spellCheck={false} />
                <div className="actions" style={{ marginTop: 12 }}>
                  <button className="primary" onClick={importFxCsvText}>Import FX CSV</button>
                </div>
              </div>
              <div className="card">
                <h2>Manual CSV Fallback</h2>
                <textarea value={csv} onChange={(event) => setCsv(event.target.value)} spellCheck={false} />
                <div className="actions" style={{ marginTop: 12 }}>
                  <button className="primary" onClick={importCsv}>Stage and Commit</button>
                </div>
              </div>
              <div className="card">
                <h2>Import History</h2>
                {backup.imports.length === 0 ? <p className="message">No imports yet.</p> : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr><th>Provider</th><th>Status</th><th>Confidence</th><th>Created</th></tr>
                      </thead>
                      <tbody>
                        {backup.imports.map((run) => (
                          <tr key={run.id}><td>{run.provider}</td><td>{run.status}</td><td>{run.confidence}</td><td>{new Date(run.createdAt).toLocaleString()}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {view === "backup" && (
          <section className="grid two">
            <div className="card">
              <h2>Restore Canonical JSON</h2>
              <input type="file" accept="application/json" onChange={(event) => restoreBackup(event.target.files?.[0])} />
            </div>
            <div className="card">
              <h2>Canonical Format</h2>
              <p className="message">A single versioned JSON file restores accounts, balances, imports, goals, prices, and source metadata.</p>
              <pre>{JSON.stringify({ schemaVersion: backup.schemaVersion, baseCurrency: backup.baseCurrency, records: backup.manualBalances.length }, null, 2)}</pre>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="card"><div className="metric-label">{label}</div><div className="metric-value">{value}</div></div>;
}

function MiniInsight({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="mini-insight"><span>{label}</span><strong title={value}>{value}</strong><small>{detail}</small></div>;
}

function StatsCard({ title, rows }: { title: string; rows: Array<{ label: string; value: string }> }) {
  return (
    <div className="card stats-card">
      <h2>{title}</h2>
      {rows.length === 0 ? <p className="message">No data yet.</p> : rows.slice(0, 8).map((row) => (
        <div className="stat-line" key={row.label}>
          <span title={row.label}>{displayHoldingName(row.label)}</span>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  );
}

function HoldingRow({ holding, baseCurrency, onEdit }: { holding: ReturnType<typeof calculatePortfolioInsights>["holdings"][number]; baseCurrency: string; onEdit: () => void }) {
  const value = holding.valueInBase === undefined ? "FX needed" : formatMoney(holding.valueInBase, baseCurrency);
  return (
    <div className="holding-row">
      <div className="holding-name-block">
        <strong title={holding.label}>{displayHoldingName(holding.label)}</strong>
        <span>{holding.assetKind} · {holding.region} · {holding.provider}</span>
      </div>
      <div className="holding-chips">
        <span className={`badge category-${holding.category}`}>{holding.category}</span>
        <span className="badge muted-badge">{holding.quantity === undefined ? "No qty" : formatNumber(holding.quantity)}</span>
      </div>
      <div className="holding-money">
        <strong>{value}</strong>
        <span>{holding.currency === baseCurrency ? "" : formatMoney(holding.value, holding.currency)}</span>
      </div>
      <button className="icon-button" onClick={onEdit} title="Edit holding"><Pencil size={15} /></button>
    </div>
  );
}

function BalanceEditor({ draft, setDraft, onSave, onCancel }: { draft: EditableBalance; setDraft: (value: EditableBalance) => void; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="editor-grid balance-editor">
      <label>Name<input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>
      <label>Category<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as AssetCategory })}>{categoryOrder.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
      <label>Currency<input value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value.toUpperCase() })} /></label>
      <label>Value<input type="number" step="0.01" value={draft.value} onChange={(event) => setDraft({ ...draft, value: Number(event.target.value) })} /></label>
      <label>Quantity<input type="number" step="0.000001" value={draft.quantity ?? ""} onChange={(event) => setDraft({ ...draft, quantity: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
      <label>Price<input type="number" step="0.0001" value={draft.price ?? ""} onChange={(event) => setDraft({ ...draft, price: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
      <label>As of<input type="date" value={draft.asOfDate} onChange={(event) => setDraft({ ...draft, asOfDate: event.target.value })} /></label>
      <label className="wide-field">Notes<input value={draft.notes ?? ""} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
      <div className="editor-actions"><button className="primary" onClick={onSave}><Save size={15} /> Save</button><button onClick={onCancel}><X size={15} /> Cancel</button></div>
    </div>
  );
}

function TransactionEditor({ draft, setDraft, onSave, onCancel }: { draft: EditableTransaction; setDraft: (value: EditableTransaction) => void; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="editor-grid transaction-editor">
      <label>Date<input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
      <label>Type<select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as Transaction["type"] })}>{transactionTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
      <label>Currency<input value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value.toUpperCase() })} /></label>
      <label>Amount<input type="number" step="0.01" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: Number(event.target.value) })} /></label>
      <label>Quantity<input type="number" step="0.000001" value={draft.quantity ?? ""} onChange={(event) => setDraft({ ...draft, quantity: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
      <label>Price<input type="number" step="0.0001" value={draft.price ?? ""} onChange={(event) => setDraft({ ...draft, price: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
      <label>Fees<input type="number" step="0.01" value={draft.fees ?? 0} onChange={(event) => setDraft({ ...draft, fees: Number(event.target.value) })} /></label>
      <label>Taxes<input type="number" step="0.01" value={draft.taxes ?? 0} onChange={(event) => setDraft({ ...draft, taxes: Number(event.target.value) })} /></label>
      <div className="editor-actions"><button className="primary" onClick={onSave}><Save size={15} /> Save</button><button onClick={onCancel}><X size={15} /> Cancel</button></div>
    </div>
  );
}

function viewTitle(view: View): string {
  if (view === "imports") return "Imports";
  if (view === "backup") return "Backup and Restore";
  if (view === "records") return "Records and Editing";
  return "Dashboard";
}

function displayHoldingName(name: string): string {
  const cleaned = name
    .replace(/^Registrar\s*:\s*[^\s]+\s+/i, "")
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s+formerly\s+.*$/i, "")
    .replace(/\s+erstwhile\s+.*$/i, "")
    .replace(/\s+-\s+Direct Plan\s+-\s+Growth Option/i, " Direct Growth")
    .replace(/\s+-\s+Direct Plan\s+-\s+Growth/i, " Direct Growth")
    .replace(/\s+-\s+Direct Plan Growth/i, " Direct Growth")
    .replace(/\s+-\s+Direct Growth/i, " Direct Growth")
    .replace(/\s+-\s+Growth Option/i, " Growth")
    .replace(/\s+Plan\s+Growth/i, " Growth")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= 58) return cleaned;
  return cleaned.slice(0, 55).trimEnd() + "...";
}

function transactionSearchText(tx: Transaction, backup: PortfolioBackup): string {
  const instrument = backup.instruments.find((item) => item.id === tx.instrumentId);
  const account = backup.accounts.find((item) => item.id === tx.accountId);
  return [tx.date, tx.type, tx.currency, tx.amount, tx.source.provider, instrument?.name, instrument?.symbol, account?.name, account?.institution].join(" ").toLowerCase();
}

function optionalNumber(value: number | undefined): number | undefined {
  return value === undefined || Number.isNaN(value) ? undefined : Number(value);
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 6 }).format(value);
}
