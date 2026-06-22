"use client";

import { Download, FileJson, LayoutDashboard, RefreshCw, RotateCcw, Upload } from "lucide-react";
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
import { createEmptyBackup, parseBackup, type AssetCategory, type PortfolioBackup } from "@/src/schema/backup";

const sampleTemplate = `account_name,asset_name,asset_type,category,currency,current_value,as_of_date,notes\nCash Wallet,Cash Wallet,cash,Cash,INR,10000,2026-06-22,liquid cash\nEmployer ESPP,ESPP Contribution,espp,Equity,USD,2000,2026-06-22,total contribution\nPPF,Public Provident Fund,ppf,Debt,INR,300000,2026-06-22,manual balance`;

const categoryOrder: AssetCategory[] = ["Equity", "Debt", "Gold", "Others", "Cash"];

type View = "dashboard" | "imports" | "backup";

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

  const summary = useMemo(() => calculatePortfolioSummary(backup), [backup]);
  const insights = useMemo(() => calculatePortfolioInsights(backup), [backup]);
  const allocation = summary.allocation;

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

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Portfolio Tracker</div>
        <nav className="nav" aria-label="Primary">
          <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>
            <LayoutDashboard size={18} /> Dashboard
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
              <Metric label="Imports" value={String(backup.imports.length)} />
            </div>
            {summary.missingFx.length > 0 && (
              <div className="notice">Missing FX rate(s): {summary.missingFx.join(", ")}. Refresh market data or add real USD/INR rates under Imports to include foreign-currency holdings in INR totals.</div>
            )}
            {insights.transactionStats.missingFx.length > 0 && (
              <div className="notice">INR cash-flow analytics are incomplete because transaction-date FX is missing. Import USD/INR CSV rows for the listed transaction dates.</div>
            )}
            <div className="grid two">
              <div className="card wide-card">
                <h2>Holdings</h2>
                {insights.holdings.length === 0 ? (
                  <p className="message">No holdings yet.</p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Category</th>
                          <th>Kind</th>
                          <th>Region</th>
                          <th>Qty</th>
                          <th>Price</th>
                          <th>Current Value</th>
                          <th>Local Value</th>
                          <th>As of</th>
                          <th>Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {insights.holdings.map((holding) => (
                          <tr key={holding.id}>
                            <td>{holding.label}</td>
                            <td><span className="badge">{holding.category}</span></td>
                            <td>{holding.assetKind}</td>
                            <td>{holding.region}</td>
                            <td>{holding.quantity === undefined ? "-" : formatNumber(holding.quantity)}</td>
                            <td>{holding.price === undefined ? "-" : formatMoney(holding.price, holding.currency)}</td>
                            <td>{holding.valueInBase === undefined ? "FX needed" : formatMoney(holding.valueInBase, backup.baseCurrency)}</td>
                            <td>{holding.currency === backup.baseCurrency ? "-" : formatMoney(holding.value, holding.currency)}</td>
                            <td>{holding.asOfDate}</td>
                            <td>{holding.provider}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
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
            </div>
            <div className="grid three">
              <StatsCard title="XIRR" rows={[{ label: backup.baseCurrency + " base", value: insights.xirrBase === null ? "-" : `${insights.xirrBase.toFixed(2)}%` }, ...Object.entries(insights.xirrByCurrency).map(([currency, value]) => ({ label: currency + " local", value: value === null ? "-" : `${value.toFixed(2)}%` }))]} />
              <StatsCard title="By Asset Type" rows={insights.totalsByAssetKind.map((item) => ({ label: item.name, value: formatMoney(item.value, backup.baseCurrency) }))} />
              <StatsCard title="By Region" rows={insights.totalsByRegion.map((item) => ({ label: item.name, value: formatMoney(item.value, backup.baseCurrency) }))} />
            </div>
            <div className="grid two">
              <StatsCard title="Cash Flows" rows={[
                { label: "Invested", value: formatMoney(insights.transactionStats.investedBase, backup.baseCurrency) },
                { label: "Income", value: formatMoney(insights.transactionStats.incomeBase, backup.baseCurrency) },
                { label: "Fees & tax", value: formatMoney(insights.transactionStats.feesAndTaxesBase, backup.baseCurrency) }
              ]} />
              <StatsCard title="By Institution / AMC" rows={insights.totalsByIssuer.map((item) => ({ label: item.name, value: formatMoney(item.value, backup.baseCurrency) }))} />
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

function StatsCard({ title, rows }: { title: string; rows: Array<{ label: string; value: string }> }) {
  return (
    <div className="card stats-card">
      <h2>{title}</h2>
      {rows.length === 0 ? <p className="message">No data yet.</p> : rows.slice(0, 8).map((row) => (
        <div className="stat-line" key={row.label}>
          <span>{row.label}</span>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  );
}

function viewTitle(view: View): string {
  if (view === "imports") return "Imports";
  if (view === "backup") return "Backup and Restore";
  return "Dashboard";
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 6 }).format(value);
}
