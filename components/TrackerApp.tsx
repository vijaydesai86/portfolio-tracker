"use client";

import { AlertTriangle, Download, FileJson, LayoutDashboard, Pencil, RefreshCw, RotateCcw, Search, ShieldCheck, Table2, TrendingDown, TrendingUp, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { calculatePortfolioInsights, calculatePortfolioSummary, tryConvertToBase } from "@/src/domain/analytics";
import { buildReadinessModules, type ReadinessModule } from "@/src/domain/assetModules";
import { lossWatchlist, topGainContributors, type HoldingPerformanceRow } from "@/src/domain/holdingPerformance";
import { buildPortfolioTimeline, type PortfolioTimelinePoint } from "@/src/domain/performanceTimeline";
import { detectImportSource, type ImportDetection } from "@/src/importers/detectImport";
import { extractPdfTextInBrowser } from "@/src/importers/browserPdfText";
import { applyCanonicalCasImport, buildCanonicalCasImport, parseCasText, type CasCanonicalImport, type CasParseResult } from "@/src/importers/casText";
import { applyCanonicalIndMoneyImport, buildCanonicalIndMoneyImport, parseIndMoneyWorkbook, type IndMoneyCanonicalImport, type IndMoneyParseResult } from "@/src/importers/indmoneyXlsx";
import { applyCanonicalEpfoImport, buildCanonicalEpfoImport, parseEpfoPassbookText, type EpfoCanonicalImport, type EpfoPassbookParseResult } from "@/src/importers/epfoPassbook";
import { applyCanonicalNpsImport, buildCanonicalNpsImport, parseNpsCsv, type NpsCanonicalImport, type NpsParseResult } from "@/src/importers/npsStatement";
import { commitManualCsvImport } from "@/src/importers/importPipeline";
import { providerImportSpecs } from "@/src/importers/providerRegistry";
import { applyMarketDataPayload, type MarketDataPayload } from "@/src/marketData/marketData";
import { buildUsdInrSnapshot, mergePriceSnapshots, parseUsdInrFxCsv } from "@/src/marketData/manualFx";
import { createEmptyBackup, parseBackup, type AssetCategory, type ManualBalance, type PortfolioBackup, type Transaction } from "@/src/schema/backup";

const sampleTemplate = `account_name,asset_name,asset_type,category,currency,current_value,as_of_date,notes\nCash Wallet,Cash Wallet,cash,Cash,INR,10000,2026-06-22,liquid cash\nEmployer ESPP,ESPP Contribution,espp,Equity,USD,2000,2026-06-22,total contribution\nPPF,Public Provident Fund,ppf,Debt,INR,300000,2026-06-22,manual balance`;

const categoryOrder: AssetCategory[] = ["Equity", "Debt", "Gold", "Others", "Cash"];
const chartColors = ["#2563eb", "#64748b", "#b7791f", "#7c3aed", "#0f766e", "#db2777", "#ea580c", "#0891b2"];
const assetClassCards = [
  { key: "Equity", title: "Equity", description: "MF, Indian stocks, US stocks, ESPP" },
  { key: "Debt", title: "Debt", description: "Debt MF, PF, PPF, SSY, NPS debt, FD" },
  { key: "Gold", title: "Gold", description: "Gold funds, SGB, physical/manual gold" },
  { key: "Cash", title: "Cash", description: "Savings, broker cash, emergency funds" },
  { key: "Others", title: "Others", description: "Hybrid, unclassified, custom assets" }
] as const satisfies Array<{ key: AssetCategory; title: string; description: string }>;

const transactionTypes: Transaction["type"][] = ["buy", "sell", "sip", "redemption", "switch_in", "switch_out", "dividend", "interest", "interest_accrual", "deposit", "withdrawal", "fee", "tax", "maturity", "contribution", "split"];

type View = "dashboard" | "holdings" | "transactions" | "imports" | "backup";
type AnalyticsTab = "overview" | "allocation" | "growth" | "risk";
type HoldingSort = "value" | "gain" | "name" | "category" | "source";

type HoldingCost = {
  invested: number;
  profit?: number;
  returnPercent?: number;
};


type DashboardSignal = {
  label: string;
  value: string;
  detail: string;
  tone: "good" | "warn" | "neutral";
  icon: "shield" | "alert" | "trend";
};

export function TrackerApp() {
  const [backup, setBackup] = useState<PortfolioBackup>(() => createEmptyBackup("INR"));
  const [view, setView] = useState<View>("dashboard");
  const [csv, setCsv] = useState(sampleTemplate);
  const [errors, setErrors] = useState<string[]>([]);
  const [nativeDetection, setNativeDetection] = useState<ImportDetection | null>(null);
  const [nativeFiles, setNativeFiles] = useState<File[]>([]);
  const [casPassword, setCasPassword] = useState("");
  const [casParse, setCasParse] = useState<CasParseResult | null>(null);
  const [stagedCas, setStagedCas] = useState<CasCanonicalImport | null>(null);
  const [indParse, setIndParse] = useState<IndMoneyParseResult | null>(null);
  const [stagedInd, setStagedInd] = useState<IndMoneyCanonicalImport | null>(null);
  const [epfoParse, setEpfoParse] = useState<EpfoPassbookParseResult[] | null>(null);
  const [stagedEpfo, setStagedEpfo] = useState<EpfoCanonicalImport[] | null>(null);
  const [npsParse, setNpsParse] = useState<NpsParseResult[] | null>(null);
  const [stagedNps, setStagedNps] = useState<NpsCanonicalImport[] | null>(null);
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
  const [analyticsTab, setAnalyticsTab] = useState<AnalyticsTab>("overview");

  const summary = useMemo(() => calculatePortfolioSummary(backup), [backup]);
  const insights = useMemo(() => calculatePortfolioInsights(backup), [backup]);
  const timeline = useMemo(() => buildPortfolioTimeline(backup), [backup]);
  const allocation = summary.allocation;
  const holdingCosts = useMemo(() => calculateHoldingCosts(backup), [backup]);
  const performance = useMemo(() => {
    const grossCashIn = insights.transactionStats.investedBase;
    const current = summary.netWorth;
    const cashOut = insights.transactionStats.incomeBase;
    const feesAndTax = insights.transactionStats.feesAndTaxesBase;
    const netInvested = grossCashIn - cashOut;
    const currentProfit = current - netInvested;
    const totalProfit = currentProfit - feesAndTax;
    return {
      grossCashIn,
      current,
      cashOut,
      feesAndTax,
      netInvested,
      currentProfit,
      totalProfit,
      absoluteReturnPercent: netInvested === 0 ? null : (totalProfit / netInvested) * 100
    };
  }, [insights.transactionStats, summary.netWorth]);

  const chartData = useMemo(() => ({
    allocation: categoryOrder.map((category) => ({ name: category, value: allocation[category].value, percent: allocation[category].percent })).filter((item) => item.value > 0),
    assetType: insights.totalsByAssetKind.slice(0, 8),
    region: insights.totalsByRegion.slice(0, 8),
    issuer: insights.totalsByIssuer.slice(0, 8),
    category: insights.totalsByCategory.filter((item) => item.value > 0),
    institution: insights.totalsByInstitution.slice(0, 8),
    provider: insights.totalsByProvider.slice(0, 8)
  }), [allocation, insights.totalsByAssetKind, insights.totalsByCategory, insights.totalsByInstitution, insights.totalsByIssuer, insights.totalsByProvider, insights.totalsByRegion]);

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
  const assetClassSummary = assetClassCards.map((asset) => {
    const bucket = allocation[asset.key];
    const count = insights.holdings.filter((holding) => holding.category === asset.key).length;
    return { ...asset, value: bucket.value, percent: bucket.percent, count };
  });

  const holdingPerformance = useMemo<HoldingPerformanceRow[]>(() => insights.holdings.map((holding) => {
    const cost = holdingCosts.get(holding.id);
    return {
      id: holding.id,
      name: displayHoldingName(holding.label),
      value: holding.valueInBase ?? 0,
      profit: cost?.profit,
      returnPercent: cost?.returnPercent,
      meta: [holding.assetKind, holding.region, holding.provider].filter(Boolean).join(" · ")
    };
  }), [holdingCosts, insights.holdings]);

  const topGainers = useMemo(() => topGainContributors(holdingPerformance), [holdingPerformance]);
  const topLosers = useMemo(() => lossWatchlist(holdingPerformance), [holdingPerformance]);
  const totalFxIssues = new Set([...summary.missingFx, ...insights.transactionStats.missingFx]).size;
  const staleHoldings = insights.holdings.filter((holding) => daysSince(holding.asOfDate) > 7).length;
  const reviewCategoryCount = insights.holdings.filter((holding) => holding.category === "Others").length;
  const performanceBridge = [
    { name: "Gross Cash In", value: performance.grossCashIn },
    { name: "Net Invested", value: performance.netInvested },
    { name: "Current Value", value: performance.current },
    { name: "Total P/L", value: performance.totalProfit }
  ].filter((item) => item.value !== 0);
  const dashboardSignals: DashboardSignal[] = [
    {
      label: "Market Data",
      value: totalFxIssues === 0 ? "Covered" : totalFxIssues + " gap(s)",
      detail: totalFxIssues === 0 ? "NAV, quotes, and FX are usable for INR analytics." : "Refresh or add real FX/NAV data before trusting INR totals.",
      tone: totalFxIssues === 0 ? "good" : "warn",
      icon: totalFxIssues === 0 ? "shield" : "alert"
    },
    {
      label: "Freshness",
      value: staleHoldings === 0 ? "Current" : staleHoldings + " stale",
      detail: staleHoldings === 0 ? "All holdings are within the freshness window." : "Some valuations are older than 7 days.",
      tone: staleHoldings === 0 ? "good" : "warn",
      icon: staleHoldings === 0 ? "shield" : "alert"
    },
    {
      label: "Concentration",
      value: topFivePercent.toFixed(1) + "%",
      detail: "Portfolio value held by the five largest positions.",
      tone: topFivePercent > 60 ? "warn" : "neutral",
      icon: "trend"
    },
    {
      label: "Classification",
      value: reviewCategoryCount === 0 ? "Clean" : reviewCategoryCount + " review",
      detail: reviewCategoryCount === 0 ? "No holdings are parked in Others." : "Others is visible so hybrid/custom records can be reviewed.",
      tone: reviewCategoryCount === 0 ? "good" : "warn",
      icon: reviewCategoryCount === 0 ? "shield" : "alert"
    }
  ];
  const readinessModules: ReadinessModule[] = buildReadinessModules(insights.holdings);
  const categoryTimelineKeys = categoryOrder.filter((category) => timeline.points.some((point) => (point.category[category] ?? 0) > 0));
  const regionTimelineKeys = topTimelineKeys(timeline.points, "region", 5);
  const assetKindTimelineKeys = topTimelineKeys(timeline.points, "assetKind", 6);
  const issuerTimelineKeys = topTimelineKeys(timeline.points, "issuer", 8);

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

  async function inspectNativeFile(fileList: FileList | File[] | undefined) {
    const files = Array.from(fileList ?? []);
    const file = files[0];
    if (!file) return;
    setNativeFiles(files);
    setCasParse(null);
    setStagedCas(null);
    setIndParse(null);
    setStagedInd(null);
    setEpfoParse(null);
    setStagedEpfo(null);
    setNpsParse(null);
    setStagedNps(null);
    const lowerName = file.name.toLowerCase();
    const canReadText = lowerName.endsWith(".csv") || lowerName.endsWith(".json") || lowerName.endsWith(".html") || lowerName.endsWith(".txt");
    const textSample = canReadText ? (await file.text()).slice(0, 20000) : "";
    const detection = detectImportSource({ fileName: file.name, mimeType: file.type, textSample });
    setNativeDetection(detection);

    if (detection.providerId === "cas_pdf") {
      setStatus(`${detection.label}: enter the PDF password and parse in browser.`);
    } else if (detection.providerId === "indmoney_export") {
      setStatus(`${detection.label}: parse the XLSX ledger in browser.`);
    } else if (detection.providerId === "epfo_passbook") {
      setStatus(`${detection.label}: parse ${files.length > 1 ? files.length + " PF PDFs" : "the PF PDF"} in browser.`);
    } else if (detection.providerId === "nps_statement" && detection.nativeInputType === "csv") {
      setStatus(`${detection.label}: parse ${files.length > 1 ? files.length + " NPS CSVs" : "the NPS CSV"} in browser.`);
    } else if (detection.providerId === "nps_statement") {
      setStatus(`${detection.label}: detected, but only the verified CSV statement parser is implemented.`);
    } else if (detection.status === "implemented") {
      setStatus(`${detection.label}: implemented import path detected.`);
    } else {
      setStatus(`${detection.label}: native file detected, parser not implemented yet.`);
    }
  }

  async function parseCasPdfInBrowser() {
    const nativeFile = nativeFiles[0];
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
    const nativeFile = nativeFiles[0];
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

  async function parseEpfoPdfInBrowser() {
    const files = nativeFiles.filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    if (files.length === 0) {
      setErrors(["Select one or more PF PDF files first."]);
      return;
    }
    setErrors([]);
    setStatus("Extracting " + files.length + " PF PDF file(s) in browser...");

    try {
      const parsedFiles: EpfoPassbookParseResult[] = [];
      const stagedFiles: EpfoCanonicalImport[] = [];
      for (const [index, file] of files.entries()) {
        const text = await extractPdfTextInBrowser(file);
        const parsed = parseEpfoPassbookText(text);
        const imported = buildCanonicalEpfoImport(parsed, {
          importId: `epfo_${Date.now()}_${index}`,
          fileName: file.name
        });
        parsedFiles.push(parsed);
        stagedFiles.push(imported);
      }
      setEpfoParse(parsedFiles);
      setStagedEpfo(stagedFiles);
      const allErrors = parsedFiles.flatMap((parsed) => [...parsed.errors, ...parsed.warnings]);
      setErrors(allErrors);
      const latestDate = latestAsOfDate(parsedFiles.map((parsed) => parsed.asOfDate));
      const transactionCount = stagedFiles.reduce((sum, imported) => sum + imported.transactions.length, 0);
      setStatus(allErrors.some(Boolean) && parsedFiles.some((parsed) => parsed.errors.length > 0) ? `PF parsed with errors across ${files.length} file(s).` : `PF staged: ${files.length} file(s), ${transactionCount} transactions, latest closing ${latestDate}.`);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Unable to parse PF PDF"]);
      setStatus("PF PDF import failed.");
    }
  }

  async function parseNpsCsvInBrowser() {
    const files = nativeFiles.filter((file) => file.type === "text/csv" || file.name.toLowerCase().endsWith(".csv"));
    if (files.length === 0) {
      setErrors(["Select one or more NPS CSV files first."]);
      return;
    }
    setErrors([]);
    setStatus("Parsing " + files.length + " NPS CSV file(s) in browser...");

    try {
      const parsedFiles: NpsParseResult[] = [];
      const stagedFiles: NpsCanonicalImport[] = [];
      for (const [index, file] of files.entries()) {
        const parsed = parseNpsCsv(await file.text());
        const imported = buildCanonicalNpsImport(parsed, {
          importId: `nps_${Date.now()}_${index}`,
          fileName: file.name
        });
        parsedFiles.push(parsed);
        stagedFiles.push(imported);
      }
      setNpsParse(parsedFiles);
      setStagedNps(stagedFiles);
      const allErrors = parsedFiles.flatMap((parsed) => [...parsed.errors, ...parsed.warnings]);
      setErrors(allErrors);
      const latestDate = latestAsOfDate(parsedFiles.map((parsed) => parsed.asOfDate));
      const transactionCount = stagedFiles.reduce((sum, imported) => sum + imported.transactions.length, 0);
      setStatus(parsedFiles.some((parsed) => parsed.errors.length > 0) ? `NPS parsed with errors across ${files.length} file(s).` : `NPS staged: ${files.length} file(s), ${transactionCount} transactions, latest holdings ${latestDate}.`);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Unable to parse NPS CSV"]);
      setStatus("NPS CSV import failed.");
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

  function commitStagedEpfo() {
    if (!stagedEpfo || stagedEpfo.length === 0) return;
    const next = stagedEpfo.reduce((current, imported) => applyCanonicalEpfoImport(current, imported), backup);
    setBackup(next);
    setErrors([]);
    setStagedEpfo(null);
    const transactionCount = stagedEpfo.reduce((sum, imported) => sum + imported.transactions.length, 0);
    setStatus(`PF committed: ${stagedEpfo.length} file(s), ${transactionCount} transactions; latest closing balances retained.`);
  }

  function commitStagedNps() {
    if (!stagedNps || stagedNps.length === 0) return;
    const next = stagedNps.reduce((current, imported) => applyCanonicalNpsImport(current, imported), backup);
    setBackup(next);
    setErrors([]);
    setStagedNps(null);
    const transactionCount = stagedNps.reduce((sum, imported) => sum + imported.transactions.length, 0);
    setStatus(`NPS committed: ${stagedNps.length} file(s), ${transactionCount} transactions; latest scheme balances retained.`);
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
    const historyDates = [
      ...portfolio.transactions.map((tx) => tx.date),
      ...portfolio.manualBalances.map((balance) => balance.asOfDate)
    ].filter(Boolean).sort();

    if (isins.length === 0 && symbols.length === 0 && fxDates.length === 0) {
      setStatus(prefix ?? "No mutual fund ISINs, US stock symbols, or USD cash flows available for market refresh.");
      return;
    }

    setStatus(prefix ? prefix + " Refreshing live and historical market data..." : "Refreshing live and historical market data...");
    setErrors([]);
    const params = new URLSearchParams();
    if (isins.length > 0) params.set("isins", [...new Set(isins)].join(","));
    if (symbols.length > 0) params.set("symbols", [...new Set(symbols)].join(","));
    const today = new Date().toISOString().slice(0, 10);
    if (fxDates.length > 0) {
      params.set("fxStart", fxDates[0]);
      params.set("fxEnd", today);
    }
    if (historyDates.length > 0 && (isins.length > 0 || symbols.length > 0)) {
      params.set("historyStart", historyDates[0]);
      params.set("historyEnd", today);
    }

    try {
      const response = await fetch("/api/market-data?" + params.toString());
      const payload = (await response.json()) as MarketDataPayload;
      setBackup(applyMarketDataPayload(portfolio, payload));
      setErrors(payload.errors);
      setStatus(
        (prefix ? prefix + " " : "") +
          `Market refresh complete: ${payload.navs.length} NAV snapshot(s), ${payload.stocks.length} US price snapshot(s), ${(payload.fxs?.length ?? 0) + (payload.fx ? 1 : 0)} USD/INR rate(s).`
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
            <button onClick={refreshMarketData} title="Refresh live and historical NAV, quotes, and FX"><RefreshCw size={16} /> Refresh</button>
            <button onClick={exportBackup} title="Export canonical JSON backup"><Download size={16} /> Export</button>
            <button onClick={resetPortfolio} title="Reset local portfolio"><RotateCcw size={16} /> Reset</button>
          </div>
        </header>

        {errors.length > 0 && <div className="error-list global-errors">{errors.map((error) => <div key={error}>{error}</div>)}</div>}

        {view === "dashboard" && (
          <section className="analytics-command pro-analytics">
            <div className="command-hero analytics-hero-v3">
              <div className="hero-ledger">
                <span className="eyebrow">Portfolio command center</span>
                <h2>{formatMoney(performance.current, backup.baseCurrency)}</h2>
                <p>{insights.holdings.length} holdings, {backup.transactions.length} transactions, {importProviders} source(s). Analytics are split into overview, allocation, growth, and risk so deeper views stay navigable as PF, NPS, stocks, cash, FD, PPF, SSY, and ESPP expand.</p>
                <div className="hero-meta-row">
                  <span>{backup.baseCurrency} base</span>
                  <span>{timeline.coverage.pricedDates}/{timeline.coverage.totalDates} complete valuation date(s)</span>
                  <span>{summary.missingFx.length === 0 ? "FX covered" : summary.missingFx.length + " FX pair gap(s)"}</span>
                </div>
              </div>
              <div className="hero-stack">
                <div className={"profit-tile " + (performance.totalProfit >= 0 ? "positive" : "negative")}>
                  <span>Total Profit / Loss</span>
                  <strong>{formatMoney(performance.totalProfit, backup.baseCurrency)}</strong>
                  <small>{performance.absoluteReturnPercent === null ? "Return unavailable" : performance.absoluteReturnPercent.toFixed(2) + "% simple return after fees/tax"}</small>
                </div>
                <div className="xirr-tile">
                  <span>XIRR</span>
                  <strong>{insights.xirrBase === null ? "-" : insights.xirrBase.toFixed(2) + "%"}</strong>
                  <small>Timing-aware return using transaction-date FX when available</small>
                </div>
              </div>
            </div>

            <AnalyticsTabs active={analyticsTab} setActive={setAnalyticsTab} />

            {(summary.missingFx.length > 0 || insights.transactionStats.missingFx.length > 0) && (
              <div className="notice critical-notice">Missing FX/NAV inputs affect INR analytics: {[...new Set([...summary.missingFx, ...insights.transactionStats.missingFx])].join(", ")}. Refresh market data or import real rates under Imports.</div>
            )}

            {analyticsTab === "overview" && (
              <div className="analytics-tab-panel">
                <div className="wealth-strip main-wealth-strip">
                  <Metric label="Invested" value={formatMoney(performance.netInvested, backup.baseCurrency)} />
                  <Metric label="Current Value" value={formatMoney(performance.current, backup.baseCurrency)} />
                  <Metric label="Profit / Loss" value={formatMoney(performance.totalProfit, backup.baseCurrency)} />
                </div>
                <div className="feature-grid">
                  <ChartCard title="Portfolio Growth"><PortfolioGrowthChart points={timeline.points} currency={backup.baseCurrency} /></ChartCard>
                  <div className="signal-panel cardless-panel">
                    <div className="panel-heading"><span>Portfolio Signals</span><strong>{dashboardSignals.filter((signal) => signal.tone === "warn").length} action(s)</strong></div>
                    <div className="signal-list">{dashboardSignals.map((signal) => <SignalCard signal={signal} key={signal.label} />)}</div>
                  </div>
                </div>
                <div className="sub-analytics-strip">
                  <MiniInsight label="Lifetime Cash In" value={formatMoney(performance.grossCashIn, backup.baseCurrency)} detail="buy, SIP, deposit, contribution" />
                  <MiniInsight label="Lifetime Cash Out" value={formatMoney(performance.cashOut, backup.baseCurrency)} detail="sell, redemption, dividend, interest, maturity, withdrawal" />
                  <MiniInsight label="Fees & Taxes" value={formatMoney(performance.feesAndTax, backup.baseCurrency)} detail="recorded charges and tax fields" />
                  <MiniInsight label="Current P/L Before Fees" value={formatMoney(performance.currentProfit, backup.baseCurrency)} detail="current value minus net invested" />
                </div>
              </div>
            )}

            {analyticsTab === "allocation" && (
              <div className="analytics-tab-panel">
                <div className="asset-class-grid asset-command-grid">
                  {assetClassSummary.map((asset) => (
                    <div className={"asset-class-card asset-" + asset.key} key={asset.key}>
                      <div><span>{asset.title}</span><strong>{formatMoney(asset.value, backup.baseCurrency)}</strong></div>
                      <small>{asset.count} holding(s) · {asset.percent.toFixed(1)}%</small>
                      <p>{asset.description}</p>
                    </div>
                  ))}
                </div>
                <div className="analytics-grid">
                  <ChartCard title="Allocation Map"><DonutChart data={chartData.allocation} /></ChartCard>
                  <ChartCard title="Asset Class Value History"><BreakdownGrowthChart points={timeline.points} field="category" keys={categoryTimelineKeys} currency={backup.baseCurrency} /></ChartCard>
                  <ChartCard title="Region Value History"><BreakdownGrowthChart points={timeline.points} field="region" keys={regionTimelineKeys} currency={backup.baseCurrency} /></ChartCard>
                  <ChartCard title="By Region"><HorizontalBar data={chartData.region} currency={backup.baseCurrency} /></ChartCard>
                </div>
              </div>
            )}

            {analyticsTab === "growth" && (
              <div className="analytics-tab-panel">
                <div className="analytics-grid">
                  <ChartCard title="Asset Type Value History"><BreakdownGrowthChart points={timeline.points} field="assetKind" keys={assetKindTimelineKeys} currency={backup.baseCurrency} /></ChartCard>
                  <ChartCard title="Issuer / AMC Value History"><BreakdownGrowthChart points={timeline.points} field="issuer" keys={issuerTimelineKeys} currency={backup.baseCurrency} /></ChartCard>
                  <ChartCard title="Performance Bridge"><HorizontalBar data={performanceBridge} currency={backup.baseCurrency} /></ChartCard>
                  <ChartCard title="Top AMC / Institution"><HorizontalBar data={chartData.issuer} currency={backup.baseCurrency} /></ChartCard>
                  <ChartCard title="Data Source Mix"><HorizontalBar data={chartData.provider} currency={backup.baseCurrency} /></ChartCard>
                  <ChartCard title="Institution Accounts"><HorizontalBar data={chartData.institution} currency={backup.baseCurrency} /></ChartCard>
                </div>
              </div>
            )}

            {analyticsTab === "risk" && (
              <div className="analytics-tab-panel">
                <div className="risk-grid">
                  <div className="insight-summary cardless-panel">
                    <MiniInsight label="Largest Holding" value={largestHolding ? displayHoldingName(largestHolding.label) : "-"} detail={largestHolding?.valueInBase === undefined ? "" : formatMoney(largestHolding.valueInBase, backup.baseCurrency)} />
                    <MiniInsight label="Top 5 Concentration" value={topFivePercent.toFixed(1) + "%"} detail={formatMoney(topFiveValue, backup.baseCurrency)} />
                    <MiniInsight label="Dominant Category" value={chartData.category[0]?.name ?? "-"} detail={chartData.category[0] ? formatMoney(chartData.category[0].value, backup.baseCurrency) : ""} />
                  </div>
                  <HoldingRankPanel title="Top Gain Contributors" direction="gain" items={topGainers} currency={backup.baseCurrency} />
                  <HoldingRankPanel title="Loss Watchlist" direction="loss" items={topLosers} currency={backup.baseCurrency} />
                  <div className="readiness-panel cardless-panel">
                    <div className="panel-heading"><span>Asset Modules</span><strong>Extensible intake</strong></div>
                    <div className="module-list">{readinessModules.map((module) => <ReadinessRow module={module} currency={backup.baseCurrency} key={module.label} />)}</div>
                  </div>
                </div>
              </div>
            )}
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

        {view === "imports" && <ImportsView {...{ backup, csv, setCsv, importCsv, nativeDetection, nativeFileCount: nativeFiles.length, inspectNativeFile, casPassword, setCasPassword, parseCasPdfInBrowser, parseIndMoneyXlsxInBrowser, parseEpfoPdfInBrowser, parseNpsCsvInBrowser, casParse, stagedCas, commitStagedCas, indParse, stagedInd, commitStagedIndMoney, epfoParse, stagedEpfo, commitStagedEpfo, npsParse, stagedNps, commitStagedNps, fxRate, setFxRate, fxDate, setFxDate, applyManualFxRate, importFxCsvFile, fxCsv, setFxCsv, importFxCsvText }} />}

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
  inspectNativeFile: (files: FileList | File[] | undefined) => void;
  nativeFileCount: number;
  casPassword: string;
  setCasPassword: (value: string) => void;
  parseCasPdfInBrowser: () => void;
  parseIndMoneyXlsxInBrowser: () => void;
  parseEpfoPdfInBrowser: () => void;
  parseNpsCsvInBrowser: () => void;
  casParse: CasParseResult | null;
  stagedCas: CasCanonicalImport | null;
  commitStagedCas: () => void;
  indParse: IndMoneyParseResult | null;
  stagedInd: IndMoneyCanonicalImport | null;
  commitStagedIndMoney: () => void;
  epfoParse: EpfoPassbookParseResult[] | null;
  stagedEpfo: EpfoCanonicalImport[] | null;
  commitStagedEpfo: () => void;
  npsParse: NpsParseResult[] | null;
  stagedNps: NpsCanonicalImport[] | null;
  commitStagedNps: () => void;
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
  const epfoParses = props.epfoParse ?? [];
  const npsParses = props.npsParse ?? [];
  const epfoBalanceCount = epfoParses.reduce((sum, parsed) => sum + parsed.balances.length, 0);
  const epfoContributionCount = epfoParses.reduce((sum, parsed) => sum + parsed.yearlyContributions.length, 0);
  const epfoInterestCount = epfoParses.reduce((sum, parsed) => sum + parsed.yearlyInterest.length, 0);
  const epfoWarningCount = epfoParses.reduce((sum, parsed) => sum + parsed.warnings.length, 0);
  const epfoHasErrors = epfoParses.some((parsed) => parsed.errors.length > 0);
  const npsHoldingCount = npsParses.reduce((sum, parsed) => sum + parsed.holdings.length, 0);
  const npsTransactionCount = npsParses.reduce((sum, parsed) => sum + parsed.transactions.length, 0);
  const npsWarningCount = npsParses.reduce((sum, parsed) => sum + parsed.warnings.length, 0);
  const npsHasErrors = npsParses.some((parsed) => parsed.errors.length > 0);
  return (
    <section className="grid">
      <div className="grid two">
        <div className="card">
          <h2>Native File Intake</h2>
          <input type="file" multiple accept=".json,.csv,.pdf,.html,.xlsx,application/json,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => props.inspectNativeFile(event.target.files ?? undefined)} />
          {props.nativeDetection && <div className="detection"><div><span>Provider</span><strong>{props.nativeDetection.label}</strong></div><div><span>Files</span><strong>{props.nativeFileCount}</strong></div><div><span>Status</span><strong>{props.nativeDetection.status}</strong></div><div><span>Type</span><strong>{props.nativeDetection.nativeInputType}</strong></div><div><span>Confidence</span><strong>{props.nativeDetection.confidence}</strong></div><p>{props.nativeDetection.reason}</p></div>}
          {props.nativeDetection?.providerId === "cas_pdf" && <div className="native-actions"><input type="password" placeholder="CAS PDF password" value={props.casPassword} onChange={(event) => props.setCasPassword(event.target.value)} /><button className="primary" onClick={props.parseCasPdfInBrowser}>Parse CAS PDF</button></div>}
          {props.nativeDetection?.providerId === "indmoney_export" && <div className="native-actions"><button className="primary" onClick={props.parseIndMoneyXlsxInBrowser}>Parse INDMoney XLSX</button></div>}
          {props.nativeDetection?.nativeInputType === "pdf" && props.nativeDetection.providerId !== "cas_pdf" && <div className="native-actions"><button className="primary" onClick={props.parseEpfoPdfInBrowser}>Parse PF PDF{props.nativeFileCount > 1 ? "s" : ""}</button></div>}
          {props.nativeDetection?.providerId === "nps_statement" && props.nativeDetection.nativeInputType === "csv" && <div className="native-actions"><button className="primary" onClick={props.parseNpsCsvInBrowser}>Parse NPS CSV{props.nativeFileCount > 1 ? "s" : ""}</button></div>}
          {props.nativeDetection?.providerId === "nps_statement" && props.nativeDetection.nativeInputType !== "csv" && <p className="message">NPS file detected. The verified parser currently supports the yearly CSV statement format.</p>}
          {props.casParse && <div className="detection"><div><span>Schemes</span><strong>{props.casParse.schemes.length}</strong></div><div><span>Dated rows</span><strong>{props.casParse.datedRows}</strong></div><div><span>Financial rows</span><strong>{props.casParse.parsedFinancialRows}</strong></div><div><span>Warnings</span><strong>{props.casParse.warnings.length}</strong></div>{props.casParse.warnings.length > 0 && <p>{props.casParse.warnings.join("; ")}</p>}<button className="primary" onClick={props.commitStagedCas} disabled={!props.stagedCas || props.casParse.errors.length > 0}>Commit CAS Import</button></div>}
          {props.indParse && <div className="detection"><div><span>Rows</span><strong>{props.indParse.rows.length}</strong></div><div><span>Canonical</span><strong>{props.indParse.canonicalRows.length}</strong></div><div><span>Positions</span><strong>{props.indParse.positions.length}</strong></div><div><span>Warnings</span><strong>{props.indParse.warnings.length}</strong></div><button className="primary" onClick={props.commitStagedIndMoney} disabled={!props.stagedInd || props.indParse.errors.length > 0}>Commit INDMoney Import</button></div>}
          {props.epfoParse && <div className="detection"><div><span>Files</span><strong>{epfoParses.length}</strong></div><div><span>Balances</span><strong>{epfoBalanceCount}</strong></div><div><span>Contributions</span><strong>{epfoContributionCount}</strong></div><div><span>Interest</span><strong>{epfoInterestCount}</strong></div><div><span>Latest as of</span><strong>{latestAsOfDate(epfoParses.map((parsed) => parsed.asOfDate))}</strong></div><div><span>Warnings</span><strong>{epfoWarningCount}</strong></div><button className="primary" onClick={props.commitStagedEpfo} disabled={!props.stagedEpfo || epfoHasErrors}>Commit PF Import</button></div>}
          {props.npsParse && <div className="detection"><div><span>Files</span><strong>{npsParses.length}</strong></div><div><span>Schemes</span><strong>{npsHoldingCount}</strong></div><div><span>Transactions</span><strong>{npsTransactionCount}</strong></div><div><span>Latest as of</span><strong>{latestAsOfDate(npsParses.map((parsed) => parsed.asOfDate))}</strong></div><div><span>Warnings</span><strong>{npsWarningCount}</strong></div><button className="primary" onClick={props.commitStagedNps} disabled={!props.stagedNps || npsHasErrors}>Commit NPS Import</button></div>}
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

function AnalyticsTabs({ active, setActive }: { active: AnalyticsTab; setActive: (tab: AnalyticsTab) => void }) {
  const tabs: Array<{ id: AnalyticsTab; label: string; detail: string }> = [
    { id: "overview", label: "Overview", detail: "wealth, return, signals" },
    { id: "allocation", label: "Allocation", detail: "asset class and geography" },
    { id: "growth", label: "Growth", detail: "asset type, issuer, source" },
    { id: "risk", label: "Risk", detail: "concentration and review" }
  ];
  return <div className="analytics-tabs" role="tablist">{tabs.map((tab) => <button key={tab.id} className={active === tab.id ? "active" : ""} onClick={() => setActive(tab.id)}><strong>{tab.label}</strong><span>{tab.detail}</span></button>)}</div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="card"><div className="metric-label">{label}</div><div className="metric-value">{value}</div></div>;
}

function MiniInsight({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="mini-insight"><span>{label}</span><strong title={value}>{value}</strong><small>{detail}</small></div>;
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="chart-card"><h2>{title}</h2>{children}</div>;
}

function PortfolioGrowthChart({ points, currency }: { points: PortfolioTimelinePoint[]; currency: string }) {
  if (points.length === 0) return <p className="message">Import transactions and balances to build a growth timeline.</p>;
  const completeValuePoints = points.filter((point) => point.current !== null).length;
  return (
    <div className="timeline-chart-block">
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={points} margin={{ left: 6, right: 18, top: 8, bottom: 6 }}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={28} />
          <YAxis tickFormatter={(value) => compactMoney(Number(value))} width={74} />
          <Tooltip formatter={(value, name) => [formatMoney(Number(value ?? 0), currency), String(name)]} labelFormatter={(label) => String(label)} />
          <Legend />
          <Line type="monotone" dataKey="invested" stroke="#475569" strokeWidth={2.5} dot={false} name="Invested" />
          <Line type="monotone" dataKey="current" stroke="#0f766e" strokeWidth={3} dot={{ r: 3 }} connectNulls={false} name="Complete Current Value" />
        </LineChart>
      </ResponsiveContainer>
      <p className="chart-note">Current value is reconstructed from units held on each date and real historical NAV, stock quote, PF book-value, NPS statement NAV, and FX snapshots. Coverage: {completeValuePoints}/{points.length} complete valuation date(s).</p>
    </div>
  );
}

function BreakdownGrowthChart({ points, field, keys, currency }: { points: PortfolioTimelinePoint[]; field: keyof Pick<PortfolioTimelinePoint, "category" | "region" | "assetKind" | "issuer">; keys: string[]; currency: string }) {
  if (points.length === 0 || keys.length === 0) return <p className="message">No dated valuation snapshots yet for this breakdown.</p>;
  const completePoints = points.filter((point) => point.current !== null);
  const data = completePoints.map((point) => Object.fromEntries([["date", point.date], ...keys.map((key) => [key, point[field][key] ?? null])]));
  const populatedPoints = data.filter((row) => keys.some((key) => typeof row[key] === "number")).length;
  if (populatedPoints < 2) return <p className="message">Not enough historical valuation snapshots yet. Import yearly statements or historical NAV/price data to build a trend.</p>;
  return (
    <div className="timeline-chart-block">
      <ResponsiveContainer width="100%" height={292}>
        <LineChart data={data} margin={{ left: 6, right: 18, top: 8, bottom: 6 }}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={28} />
          <YAxis tickFormatter={(value) => compactMoney(Number(value))} width={74} />
          <Tooltip formatter={(value, name) => [formatMoney(Number(value ?? 0), currency), displayHoldingName(String(name))]} labelFormatter={(label) => String(label)} />
          <Legend formatter={(value) => displayHoldingName(String(value))} />
          {keys.map((key, index) => <Line key={key} type="monotone" dataKey={key} stroke={chartColors[index % chartColors.length]} strokeWidth={2.4} dot={{ r: 2 }} connectNulls={false} />)}
        </LineChart>
      </ResponsiveContainer>
      <p className="chart-note">This chart uses complete portfolio valuation dates only. Missing lines mean historical NAV, quote, or FX data is not yet available for every active holding.</p>
    </div>
  );
}

function SignalCard({ signal }: { signal: DashboardSignal }) {
  const Icon = signal.icon === "alert" ? AlertTriangle : signal.icon === "trend" ? TrendingUp : ShieldCheck;
  return <div className={"signal-item " + signal.tone}><Icon size={18} /><div><span>{signal.label}</span><strong>{signal.value}</strong><small>{signal.detail}</small></div></div>;
}

function HoldingRankPanel({ title, direction, items, currency }: { title: string; direction: "gain" | "loss"; items: HoldingPerformanceRow[]; currency: string }) {
  const Icon = direction === "gain" ? TrendingUp : TrendingDown;
  const emptyMessage = direction === "loss" ? "No holdings with negative P/L." : "Cost basis is unavailable until matching transactions and FX are complete.";
  return <div className="rank-panel cardless-panel"><div className="panel-heading"><span>{title}</span><Icon size={18} /></div>{items.length === 0 ? <p className="message">{emptyMessage}</p> : <div className="rank-list">{items.map((item) => <div className="rank-row" key={item.id}><div><strong title={item.name}>{item.name}</strong><span>{item.meta}</span></div><div className={(item.profit ?? 0) >= 0 ? "positive-text" : "negative-text"}><strong>{formatMoney(item.profit ?? 0, currency)}</strong><span>{item.returnPercent === undefined ? "-" : item.returnPercent.toFixed(1) + "%"}</span></div></div>)}</div>}</div>;
}

function ReadinessRow({ module, currency }: { module: ReadinessModule; currency: string }) {
  return <div className="module-row"><div><strong>{module.label}</strong><span>{module.detail}</span></div><div><strong>{module.count}</strong><span>{module.value > 0 ? formatMoney(module.value, currency) : "Empty"}</span></div><em>{module.category}</em></div>;
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

function daysSince(date: string): number {
  const parsed = Date.parse(date + "T00:00:00.000Z");
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, Math.floor((Date.now() - parsed) / 86400000));
}

function topTimelineKeys(points: PortfolioTimelinePoint[], field: keyof Pick<PortfolioTimelinePoint, "category" | "region" | "assetKind" | "issuer">, limit: number): string[] {
  const totals = new Map<string, number>();
  for (const point of points) {
    for (const [key, value] of Object.entries(point[field])) totals.set(key, Math.max(totals.get(key) ?? 0, value));
  }
  return [...totals.entries()].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key]) => key);
}

function shortDate(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})/);
  return match ? match[2] + "/" + match[1].slice(2) : value;
}

function latestAsOfDate(dates: string[]): string {
  return dates.filter(Boolean).sort().at(-1) ?? "unknown date";
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
