"use client";

import { Download, FileJson, LayoutDashboard, Pencil, RefreshCw, RotateCcw, Search, Table2, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { calculatePortfolioInsights, calculatePortfolioSummary, tryConvertToBase } from "@/src/domain/analytics";
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
const chartColors = ["#2563eb", "#64748b", "#b7791f", "#7c3aed", "#0f766e", "#db2777", "#ea580c", "#0891b2"];
const transactionTypes: Transaction["type"][] = ["buy", "sell", "sip", "redemption", "switch_in", "switch_out", "dividend", "interest", "deposit", "withdrawal", "fee", "tax", "maturity", "contribution", "split"];

type View = "dashboard" | "holdings" | "transactions" | "imports" | "backup";
type HoldingSort = "value" | "gain" | "name" | "category" | "source";

type HoldingCost = {
  invested: number;
  profit?: number;
  returnPercent?: number;
};

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
  const [holdingEditMode, setHoldingEditMode] = useState(false);
  const [transactionEditMode, setTransactionEditMode] = useState(false);

  const summary = useMemo(() => calculatePortfolioSummary(backup), [backup]);
  const insights = useMemo(() => calculatePortfolioInsights(backup), [backup]);
  const allocation = summary.allocation;
  const holdingCosts = useMemo(() => calculateHoldingCosts(backup), [backup]);
  const performance = useMemo(() => {
    const invested = insights.transactionStats.investedBase;
    const current = summary.netWorth;
    const returnedCash = insights.transactionStats.incomeBase;
    const feesAndTax = insights.transactionStats.feesAndTaxesBase;
    const profit = current + returnedCash - invested - feesAndTax;
    return {
      invested,
      current,
      returnedCash,
      feesAndTax,
      profit,
      returnPercent: invested === 0 ? null : (profit / invested) * 100
    };
  }, [insights.transactionStats, summary.netWorth]);

  const chartData = useMemo(() => ({
    allocation: categoryOrder.map((category) => ({ name: category, value: allocation[category].value, percent: allocation[category].percent })).filter((item) => item.value > 0),
    assetType: insights.totalsByAssetKind.slice(0, 8),
    region: insights.totalsByRegion.slice(0, 8),
    issuer: insights.totalsByIssuer.slice(0, 8),
    category: insights.totalsByCategory.filter((item) => item.value > 0)
  }), [allocation, insights.totalsByAssetKind, insights.totalsByCategory, insights.totalsByIssuer, insights.totalsByRegion]);

  const filteredHoldings = useMemo(() => {
    const q = holdingQuery.trim().toLowerCase();
    return insights.holdings
      .filter((holding) => categoryFilter === "All" || holding.category === categoryFilter)
      .filter((holding) => !q || [holding.label, holding.assetKind, holding.region, holding.provider, holding.institution, holding.issuer].join(" ").toLowerCase().includes(q))
      .sort((a, b) => {
        const aCost = holdingCosts.get(a.id);
        const bCost = holdingCosts.get(b.id);
        if (holdingSort === "name") return displayHoldingName(a.label).localeCompare(displayHoldingName(b.label));
        if (holdingSort === "category") return a.category.localeCompare(b.category) || (b.valueInBase ?? 0) - (a.valueInBase ?? 0);
        if (holdingSort === "source") return a.provider.localeCompare(b.provider) || (b.valueInBase ?? 0) - (a.valueInBase ?? 0);
        if (holdingSort === "gain") return (bCost?.profit ?? -Infinity) - (aCost?.profit ?? -Infinity);
        return (b.valueInBase ?? 0) - (a.valueInBase ?? 0);
      });
  }, [categoryFilter, holdingCosts, holdingQuery, holdingSort, insights.holdings]);

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

  function updateBalance(balanceId: string, patch: Partial<ManualBalance>) {
    const now = new Date().toISOString();
    setBackup((current) => {
      const editedBalance = current.manualBalances.find((balance) => balance.id === balanceId);
      return {
        ...current,
        exportedAt: now,
        manualBalances: current.manualBalances.map((balance) => balance.id === balanceId ? { ...balance, ...patch, userModified: true, updatedAt: now } : balance),
        instruments: current.instruments.map((instrument) => editedBalance?.instrumentId === instrument.id && patch.category ? { ...instrument, category: patch.category, updatedAt: now } : instrument)
      };
    });
    setStatus("Holding edit saved locally. Export backup to preserve browser edits outside this device.");
  }

  function updateTransaction(transactionId: string, patch: Partial<Transaction>) {
    const now = new Date().toISOString();
    setBackup((current) => ({
      ...current,
      exportedAt: now,
      transactions: current.transactions.map((tx) => tx.id === transactionId ? { ...tx, ...patch, userModified: true, updatedAt: now } : tx)
    }));
    setStatus("Transaction edit saved locally. Export backup to preserve browser edits outside this device.");
  }

  return (
    <div className="shell app-shell-v2">
      <aside className="sidebar">
        <div className="brand">Portfolio Tracker</div>
        <nav className="nav" aria-label="Primary">
          <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}><LayoutDashboard size={18} /> Analytics</button>
          <button className={view === "holdings" ? "active" : ""} onClick={() => setView("holdings")}><Table2 size={18} /> Holdings</button>
          <button className={view === "transactions" ? "active" : ""} onClick={() => setView("transactions")}><Pencil size={18} /> Transactions</button>
          <button className={view === "imports" ? "active" : ""} onClick={() => setView("imports")}><Upload size={18} /> Imports</button>
          <button className={view === "backup" ? "active" : ""} onClick={() => setView("backup")}><FileJson size={18} /> Backup</button>
        </nav>
      </aside>

      <main className="main">
        <header className="header">
          <div>
            <h1>{viewTitle(view)}</h1>
            <p>{status}</p>
          </div>
          <div className="actions">
            <button onClick={refreshMarketData} title="Refresh NAV, quotes, and FX"><RefreshCw size={16} /> Refresh</button>
            <button onClick={exportBackup} title="Export canonical JSON backup"><Download size={16} /> Export</button>
            <button onClick={resetPortfolio} title="Reset local portfolio"><RotateCcw size={16} /> Reset</button>
          </div>
        </header>

        {errors.length > 0 && <div className="error-list global-errors">{errors.map((error) => <div key={error}>{error}</div>)}</div>}

        {view === "dashboard" && (
          <section className="grid analytics-page">
            <div className="portfolio-hero card">
              <div className="hero-main">
                <span>Total Portfolio Value</span>
                <strong>{formatMoney(performance.current, backup.baseCurrency)}</strong>
                <small>{insights.holdings.length} holdings · {backup.transactions.length} transactions · {importProviders} data source(s)</small>
              </div>
              <div className={`hero-profit ${performance.profit >= 0 ? "positive" : "negative"}`}>
                <span>Current Profit / Loss</span>
                <strong>{formatMoney(performance.profit, backup.baseCurrency)}</strong>
                <small>{performance.returnPercent === null ? "Return unavailable" : `${performance.returnPercent.toFixed(2)}% absolute return`}</small>
              </div>
              <div className="hero-xirr">
                <span>XIRR</span>
                <strong>{insights.xirrBase === null ? "-" : `${insights.xirrBase.toFixed(2)}%`}</strong>
                <small>{backup.baseCurrency} base, using available transaction-date FX</small>
              </div>
            </div>

            <div className="grid metrics main-metrics">
              <Metric label="Invested" value={formatMoney(performance.invested, backup.baseCurrency)} />
              <Metric label="Current Value" value={formatMoney(performance.current, backup.baseCurrency)} />
              <Metric label="Returned Cash" value={formatMoney(performance.returnedCash, backup.baseCurrency)} />
              <Metric label="Fees and Tax" value={formatMoney(performance.feesAndTax, backup.baseCurrency)} />
            </div>

            {summary.missingFx.length > 0 && <div className="notice">Missing FX rate(s): {summary.missingFx.join(", ")}. Refresh market data or add real USD/INR rates under Imports.</div>}
            {insights.transactionStats.missingFx.length > 0 && <div className="notice">INR cash-flow analytics are incomplete because transaction-date FX is missing.</div>}

            <div className="grid analytics-grid">
              <ChartCard title="Asset Allocation"><DonutChart data={chartData.allocation} /></ChartCard>
              <ChartCard title="By Asset Type"><HorizontalBar data={chartData.assetType} currency={backup.baseCurrency} /></ChartCard>
              <ChartCard title="By Region"><HorizontalBar data={chartData.region} currency={backup.baseCurrency} /></ChartCard>
              <ChartCard title="Top AMC / Institution"><HorizontalBar data={chartData.issuer} currency={backup.baseCurrency} /></ChartCard>
            </div>

            <div className="analytics-strip">
              <MiniInsight label="Largest Holding" value={largestHolding ? displayHoldingName(largestHolding.label) : "-"} detail={largestHolding?.valueInBase === undefined ? "" : formatMoney(largestHolding.valueInBase, backup.baseCurrency)} />
              <MiniInsight label="Top 5 Concentration" value={`${topFivePercent.toFixed(1)}%`} detail={formatMoney(topFiveValue, backup.baseCurrency)} />
              <MiniInsight label="Best Group" value={chartData.category[0]?.name ?? "-"} detail={chartData.category[0] ? formatMoney(chartData.category[0].value, backup.baseCurrency) : ""} />
              <MiniInsight label="Editable Records" value={String(backup.manualBalances.length + backup.transactions.length)} detail="holdings and transactions" />
            </div>
          </section>
        )}

        {view === "holdings" && (
          <section className="grid">
            <div className="card wide-card holdings-card">
              <div className="section-head">
                <div><h2>Holdings</h2><p>Search, sort, inspect cost/profit, and turn on edit mode to change every visible field inline.</p></div>
                <div className="toolbar">
                  <button className={holdingEditMode ? "primary" : ""} onClick={() => setHoldingEditMode(!holdingEditMode)}><Pencil size={15} /> {holdingEditMode ? "Done Editing" : "Edit Holdings"}</button>
                  <label className="search-box"><Search size={15} /><input value={holdingQuery} onChange={(event) => setHoldingQuery(event.target.value)} placeholder="Search holdings" /></label>
                  <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as AssetCategory | "All")}>
                    <option value="All">All categories</option>
                    {categoryOrder.map((category) => <option value={category} key={category}>{category}</option>)}
                  </select>
                  <select value={holdingSort} onChange={(event) => setHoldingSort(event.target.value as HoldingSort)}>
                    <option value="value">Sort by value</option>
                    <option value="gain">Sort by gain</option>
                    <option value="name">Sort by name</option>
                    <option value="category">Sort by category</option>
                    <option value="source">Sort by source</option>
                  </select>
                </div>
              </div>
              {filteredHoldings.length === 0 ? <p className="message">No holdings match the current filters.</p> : (
                <div className="holding-list">
                  {filteredHoldings.map((holding) => (
                    holdingEditMode ?
                      <HoldingEditRow key={holding.id} balance={backup.manualBalances.find((balance) => balance.id === holding.id)!} updateBalance={updateBalance} /> :
                      <HoldingRow key={holding.id} holding={holding} baseCurrency={backup.baseCurrency} cost={holdingCosts.get(holding.id)} />
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {view === "transactions" && (
          <section className="grid">
            <div className="card wide-card">
              <div className="section-head">
                <div><h2>Transactions</h2><p>Every imported transaction is searchable. Edit mode makes the latest matching rows directly editable.</p></div>
                <div className="toolbar">
                  <button className={transactionEditMode ? "primary" : ""} onClick={() => setTransactionEditMode(!transactionEditMode)}><Pencil size={15} /> {transactionEditMode ? "Done Editing" : "Edit Transactions"}</button>
                  <label className="search-box"><Search size={15} /><input value={transactionQuery} onChange={(event) => setTransactionQuery(event.target.value)} placeholder="Search transactions" /></label>
                </div>
              </div>
              <div className="transaction-list">
                {filteredTransactions.length === 0 ? <p className="message">No transactions match the current search.</p> : filteredTransactions.slice(0, 300).map((tx) => (
                  transactionEditMode ?
                    <TransactionEditRow key={tx.id} tx={tx} updateTransaction={updateTransaction} /> :
                    <TransactionRow key={tx.id} tx={tx} backup={backup} />
                ))}
              </div>
              {filteredTransactions.length > 300 && <p className="message">Showing latest 300 matching transactions. Narrow the search to inspect older rows.</p>}
            </div>
          </section>
        )}

        {view === "imports" && <ImportsView {...{ backup, csv, setCsv, importCsv, nativeDetection, inspectNativeFile, casPassword, setCasPassword, parseCasPdfInBrowser, parseIndMoneyXlsxInBrowser, casParse, stagedCas, commitStagedCas, indParse, stagedInd, commitStagedIndMoney, fxRate, setFxRate, fxDate, setFxDate, applyManualFxRate, importFxCsvFile, fxCsv, setFxCsv, importFxCsvText }} />}

        {view === "backup" && (
          <section className="grid two">
            <div className="card"><h2>Restore Canonical JSON</h2><input type="file" accept="application/json" onChange={(event) => restoreBackup(event.target.files?.[0])} /></div>
            <div className="card"><h2>Canonical Format</h2><p className="message">A single versioned JSON file restores accounts, balances, imports, goals, prices, and source metadata.</p><pre>{JSON.stringify({ schemaVersion: backup.schemaVersion, baseCurrency: backup.baseCurrency, records: backup.manualBalances.length }, null, 2)}</pre></div>
          </section>
        )}
      </main>
    </div>
  );
}

function ImportsView(props: {
  backup: PortfolioBackup;
  csv: string;
  setCsv: (value: string) => void;
  importCsv: () => void;
  nativeDetection: ImportDetection | null;
  inspectNativeFile: (file: File | undefined) => void;
  casPassword: string;
  setCasPassword: (value: string) => void;
  parseCasPdfInBrowser: () => void;
  parseIndMoneyXlsxInBrowser: () => void;
  casParse: CasParseResult | null;
  stagedCas: CasCanonicalImport | null;
  commitStagedCas: () => void;
  indParse: IndMoneyParseResult | null;
  stagedInd: IndMoneyCanonicalImport | null;
  commitStagedIndMoney: () => void;
  fxRate: string;
  setFxRate: (value: string) => void;
  fxDate: string;
  setFxDate: (value: string) => void;
  applyManualFxRate: () => void;
  importFxCsvFile: (file: File | undefined) => void;
  fxCsv: string;
  setFxCsv: (value: string) => void;
  importFxCsvText: () => void;
}) {
  return (
    <section className="grid">
      <div className="grid two">
        <div className="card">
          <h2>Native File Intake</h2>
          <input type="file" accept=".json,.csv,.pdf,.html,.xlsx,application/json,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => props.inspectNativeFile(event.target.files?.[0])} />
          {props.nativeDetection && <div className="detection"><div><span>Provider</span><strong>{props.nativeDetection.label}</strong></div><div><span>Status</span><strong>{props.nativeDetection.status}</strong></div><div><span>Type</span><strong>{props.nativeDetection.nativeInputType}</strong></div><div><span>Confidence</span><strong>{props.nativeDetection.confidence}</strong></div><p>{props.nativeDetection.reason}</p></div>}
          {props.nativeDetection?.providerId === "cas_pdf" && <div className="native-actions"><input type="password" placeholder="CAS PDF password" value={props.casPassword} onChange={(event) => props.setCasPassword(event.target.value)} /><button className="primary" onClick={props.parseCasPdfInBrowser}>Parse CAS PDF</button></div>}
          {props.nativeDetection?.providerId === "indmoney_export" && <div className="native-actions"><button className="primary" onClick={props.parseIndMoneyXlsxInBrowser}>Parse INDMoney XLSX</button></div>}
          {props.casParse && <div className="detection"><div><span>Schemes</span><strong>{props.casParse.schemes.length}</strong></div><div><span>Dated rows</span><strong>{props.casParse.datedRows}</strong></div><div><span>Financial rows</span><strong>{props.casParse.parsedFinancialRows}</strong></div><div><span>Warnings</span><strong>{props.casParse.warnings.length}</strong></div>{props.casParse.warnings.length > 0 && <p>{props.casParse.warnings.join("; ")}</p>}<button className="primary" onClick={props.commitStagedCas} disabled={!props.stagedCas || props.casParse.errors.length > 0}>Commit CAS Import</button></div>}
          {props.indParse && <div className="detection"><div><span>Rows</span><strong>{props.indParse.rows.length}</strong></div><div><span>Canonical</span><strong>{props.indParse.canonicalRows.length}</strong></div><div><span>Positions</span><strong>{props.indParse.positions.length}</strong></div><div><span>Warnings</span><strong>{props.indParse.warnings.length}</strong></div><button className="primary" onClick={props.commitStagedIndMoney} disabled={!props.stagedInd || props.indParse.errors.length > 0}>Commit INDMoney Import</button></div>}
        </div>
        <div className="card"><h2>Provider Support</h2><div className="support-list">{providerImportSpecs.map((spec) => <div className="support-row" key={spec.id}><span>{spec.label}</span><strong className={`status-pill ${spec.status}`}>{spec.status}</strong></div>)}</div></div>
      </div>
      <div className="grid two">
        <div className="card"><h2>USD/INR FX Rates</h2><div className="native-actions"><input type="number" step="0.0001" placeholder="USD/INR rate" value={props.fxRate} onChange={(event) => props.setFxRate(event.target.value)} /><input type="date" value={props.fxDate} onChange={(event) => props.setFxDate(event.target.value)} /><button className="primary" onClick={props.applyManualFxRate}>Add Rate</button></div><p className="message">Use a real USD/INR rate. Current holdings use the latest rate; transaction analytics use rates on or before each transaction date.</p><input type="file" accept=".csv,text/csv" onChange={(event) => props.importFxCsvFile(event.target.files?.[0])} /><textarea value={props.fxCsv} onChange={(event) => props.setFxCsv(event.target.value)} spellCheck={false} /><div className="actions" style={{ marginTop: 12 }}><button className="primary" onClick={props.importFxCsvText}>Import FX CSV</button></div></div>
        <div className="card"><h2>Manual CSV Fallback</h2><textarea value={props.csv} onChange={(event) => props.setCsv(event.target.value)} spellCheck={false} /><div className="actions" style={{ marginTop: 12 }}><button className="primary" onClick={props.importCsv}>Stage and Commit</button></div></div>
        <div className="card"><h2>Import History</h2>{props.backup.imports.length === 0 ? <p className="message">No imports yet.</p> : <div className="table-wrap"><table><thead><tr><th>Provider</th><th>Status</th><th>Confidence</th><th>Created</th></tr></thead><tbody>{props.backup.imports.map((run) => <tr key={run.id}><td>{run.provider}</td><td>{run.status}</td><td>{run.confidence}</td><td>{new Date(run.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div>}</div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="card"><div className="metric-label">{label}</div><div className="metric-value">{value}</div></div>;
}

function MiniInsight({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="mini-insight"><span>{label}</span><strong title={value}>{value}</strong><small>{detail}</small></div>;
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="card chart-card"><h2>{title}</h2>{children}</div>;
}

function DonutChart({ data }: { data: Array<{ name: string; value: number; percent?: number }> }) {
  if (data.length === 0) return <p className="message">No data yet.</p>;
  return <div className="chart-frame"><ResponsiveContainer width="100%" height={260}><PieChart><Pie data={data} dataKey="value" nameKey="name" innerRadius={58} outerRadius={90} paddingAngle={2}>{data.map((_, index) => <Cell key={index} fill={chartColors[index % chartColors.length]} />)}</Pie><Tooltip formatter={(value, name) => [formatMoney(Number(value ?? 0), "INR"), name]} /></PieChart></ResponsiveContainer><div className="legend-list">{data.map((item, index) => <div key={item.name}><span style={{ background: chartColors[index % chartColors.length] }} />{item.name}<strong>{item.percent?.toFixed(1)}%</strong></div>)}</div></div>;
}

function HorizontalBar({ data, currency }: { data: Array<{ name: string; value: number }>; currency: string }) {
  if (data.length === 0) return <p className="message">No data yet.</p>;
  return <ResponsiveContainer width="100%" height={260}><BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 8, bottom: 8 }}><XAxis type="number" tickFormatter={(value) => compactMoney(Number(value))} /><YAxis type="category" dataKey="name" width={112} tickFormatter={(value) => displayHoldingName(String(value))} /><Tooltip formatter={(value) => formatMoney(Number(value ?? 0), currency)} /><Bar dataKey="value" fill="#2563eb" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer>;
}

function HoldingRow({ holding, baseCurrency, cost }: { holding: ReturnType<typeof calculatePortfolioInsights>["holdings"][number]; baseCurrency: string; cost?: HoldingCost }) {
  const value = holding.valueInBase === undefined ? "FX needed" : formatMoney(holding.valueInBase, baseCurrency);
  return <div className="holding-row pro-row"><div className="holding-name-block"><strong title={holding.label}>{displayHoldingName(holding.label)}</strong><span>{holding.assetKind} · {holding.region} · {holding.provider}</span></div><div className="holding-chips"><span className={`badge category-${holding.category}`}>{holding.category}</span><span className="badge muted-badge">{holding.quantity === undefined ? "No qty" : formatNumber(holding.quantity)}</span></div><div className="holding-money"><strong>{value}</strong><span>{holding.currency === baseCurrency ? "" : formatMoney(holding.value, holding.currency)}</span></div><div className="holding-money"><strong className={(cost?.profit ?? 0) >= 0 ? "positive-text" : "negative-text"}>{cost?.profit === undefined ? "-" : formatMoney(cost.profit, baseCurrency)}</strong><span>{cost?.returnPercent === undefined ? "P/L" : `${cost.returnPercent.toFixed(1)}%`}</span></div></div>;
}

function HoldingEditRow({ balance, updateBalance }: { balance: ManualBalance; updateBalance: (id: string, patch: Partial<ManualBalance>) => void }) {
  return <div className="edit-row holding-edit-row"><input value={balance.label} onChange={(event) => updateBalance(balance.id, { label: event.target.value })} /><select value={balance.category} onChange={(event) => updateBalance(balance.id, { category: event.target.value as AssetCategory })}>{categoryOrder.map((category) => <option key={category} value={category}>{category}</option>)}</select><input value={balance.currency} onChange={(event) => updateBalance(balance.id, { currency: event.target.value.toUpperCase() })} /><input type="number" step="0.01" value={balance.value} onChange={(event) => updateBalance(balance.id, { value: Number(event.target.value) })} /><input type="number" step="0.000001" value={balance.quantity ?? ""} onChange={(event) => updateBalance(balance.id, { quantity: event.target.value === "" ? undefined : Number(event.target.value) })} /><input type="number" step="0.0001" value={balance.price ?? ""} onChange={(event) => updateBalance(balance.id, { price: event.target.value === "" ? undefined : Number(event.target.value) })} /><input type="date" value={balance.asOfDate} onChange={(event) => updateBalance(balance.id, { asOfDate: event.target.value })} /><input value={balance.notes ?? ""} onChange={(event) => updateBalance(balance.id, { notes: event.target.value })} /></div>;
}

function TransactionRow({ tx, backup }: { tx: Transaction; backup: PortfolioBackup }) {
  const instrument = backup.instruments.find((item) => item.id === tx.instrumentId);
  return <div className="transaction-row pro-row"><div className="record-main"><strong>{tx.date} · {tx.type}</strong><span title={instrument?.name}>{displayHoldingName(instrument?.name ?? tx.instrumentId)} · {tx.source.provider ?? tx.source.type}</span></div><div className="record-value">{formatMoney(tx.amount, tx.currency)}</div><div className="record-value muted-value">{tx.quantity === undefined ? "-" : formatNumber(tx.quantity)}</div><div className="record-value muted-value">{tx.fees || tx.taxes ? formatMoney((tx.fees ?? 0) + (tx.taxes ?? 0), tx.currency) : "-"}</div></div>;
}

function TransactionEditRow({ tx, updateTransaction }: { tx: Transaction; updateTransaction: (id: string, patch: Partial<Transaction>) => void }) {
  return <div className="edit-row transaction-edit-row"><input type="date" value={tx.date} onChange={(event) => updateTransaction(tx.id, { date: event.target.value })} /><select value={tx.type} onChange={(event) => updateTransaction(tx.id, { type: event.target.value as Transaction["type"] })}>{transactionTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select><input value={tx.currency} onChange={(event) => updateTransaction(tx.id, { currency: event.target.value.toUpperCase() })} /><input type="number" step="0.01" value={tx.amount} onChange={(event) => updateTransaction(tx.id, { amount: Number(event.target.value) })} /><input type="number" step="0.000001" value={tx.quantity ?? ""} onChange={(event) => updateTransaction(tx.id, { quantity: event.target.value === "" ? undefined : Number(event.target.value) })} /><input type="number" step="0.0001" value={tx.price ?? ""} onChange={(event) => updateTransaction(tx.id, { price: event.target.value === "" ? undefined : Number(event.target.value) })} /><input type="number" step="0.01" value={tx.fees ?? 0} onChange={(event) => updateTransaction(tx.id, { fees: Number(event.target.value) })} /><input type="number" step="0.01" value={tx.taxes ?? 0} onChange={(event) => updateTransaction(tx.id, { taxes: Number(event.target.value) })} /></div>;
}

function calculateHoldingCosts(backup: PortfolioBackup): Map<string, HoldingCost> {
  const costByInstrument = new Map<string, number>();
  for (const tx of backup.transactions) {
    const converted = tryConvertToBase(tx.amount, tx.currency, backup, tx.date);
    if (converted === undefined) continue;
    const current = costByInstrument.get(tx.instrumentId) ?? 0;
    if (["buy", "sip", "deposit", "contribution"].includes(tx.type)) costByInstrument.set(tx.instrumentId, current + Math.abs(converted));
    if (["sell", "redemption", "withdrawal", "maturity"].includes(tx.type)) costByInstrument.set(tx.instrumentId, current - Math.abs(converted));
  }
  const costs = new Map<string, HoldingCost>();
  for (const balance of backup.manualBalances) {
    if (!balance.instrumentId) continue;
    const invested = Math.max(0, costByInstrument.get(balance.instrumentId) ?? 0);
    const current = tryConvertToBase(balance.value, balance.currency, backup);
    if (invested === 0 || current === undefined) {
      costs.set(balance.id, { invested });
      continue;
    }
    const profit = current - invested;
    costs.set(balance.id, { invested, profit, returnPercent: (profit / invested) * 100 });
  }
  return costs;
}

function viewTitle(view: View): string {
  if (view === "imports") return "Imports";
  if (view === "backup") return "Backup and Restore";
  if (view === "holdings") return "Holdings";
  if (view === "transactions") return "Transactions";
  return "Portfolio Analytics";
}

function displayHoldingName(name: string): string {
  const cleaned = name.replace(/^Registrar\s*:\s*[^\s]+\s+/i, "").replace(/\s*\([^)]*\)/g, "").replace(/\s+formerly\s+.*$/i, "").replace(/\s+erstwhile\s+.*$/i, "").replace(/\s+-\s+Direct Plan\s+-\s+Growth Option/i, " Direct Growth").replace(/\s+-\s+Direct Plan\s+-\s+Growth/i, " Direct Growth").replace(/\s+-\s+Direct Plan Growth/i, " Direct Growth").replace(/\s+-\s+Direct Growth/i, " Direct Growth").replace(/\s+-\s+Growth Option/i, " Growth").replace(/\s+Plan\s+Growth/i, " Growth").replace(/\s+/g, " ").trim();
  return cleaned.length <= 58 ? cleaned : cleaned.slice(0, 55).trimEnd() + "...";
}

function transactionSearchText(tx: Transaction, backup: PortfolioBackup): string {
  const instrument = backup.instruments.find((item) => item.id === tx.instrumentId);
  const account = backup.accounts.find((item) => item.id === tx.accountId);
  return [tx.date, tx.type, tx.currency, tx.amount, tx.source.provider, instrument?.name, instrument?.symbol, account?.name, account?.institution].join(" ").toLowerCase();
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

function compactMoney(value: number): string {
  if (Math.abs(value) >= 10000000) return `${(value / 10000000).toFixed(1)}Cr`;
  if (Math.abs(value) >= 100000) return `${(value / 100000).toFixed(1)}L`;
  return String(Math.round(value));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 6 }).format(value);
}
