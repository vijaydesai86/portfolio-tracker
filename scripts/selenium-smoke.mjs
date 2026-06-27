import fs from "node:fs";
import path from "node:path";
import { Builder, Browser, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";

const url = process.env.APP_URL ?? "http://127.0.0.1:3000";
const firefoxBinary = process.env.FIREFOX_BIN ?? "/arm/tools/mozilla/firefox/146.0.1/linux64/firefox/firefox";
const geckoDriver = process.env.GECKODRIVER_BIN ?? "/arm/tools/mozilla/geckodriver/0.35.0/linux64/geckodriver";
const screenshotPath = process.env.SCREENSHOT_PATH ?? "test-results/selenium-dashboard.png";
const downloadDir = path.resolve("test-results/downloads");
const backupDownloadPath = path.join(downloadDir, "portfolio-tracker-backup-v1.json");

fs.mkdirSync("test-results", { recursive: true });
fs.rmSync(downloadDir, { recursive: true, force: true });
fs.mkdirSync(downloadDir, { recursive: true });

const options = new firefox.Options()
  .setBinary(firefoxBinary)
  .addArguments("-headless")
  .setPreference("browser.download.folderList", 2)
  .setPreference("browser.download.dir", downloadDir)
  .setPreference("browser.download.useDownloadDir", true)
  .setPreference("browser.helperApps.neverAsk.saveToDisk", "application/json,application/octet-stream,text/json")
  .setPreference("pdfjs.disabled", true);
const service = new firefox.ServiceBuilder(geckoDriver);

const driver = await new Builder()
  .forBrowser(Browser.FIREFOX)
  .setFirefoxOptions(options)
  .setFirefoxService(service)
  .build();

async function jsClick(xpath, timeout = 15000) {
  const element = await driver.wait(until.elementLocated(By.xpath(xpath)), timeout);
  await driver.executeScript("arguments[0].scrollIntoView({block: 'center', inline: 'center'});", element);
  await driver.sleep(250);
  await driver.executeScript("arguments[0].dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window}));", element);
}

async function waitForBodyText(text, timeout = 15000) {
  await driver.wait(async () => (await driver.findElement(By.css("body")).getText()).toLowerCase().includes(text.toLowerCase()), timeout);
}

async function waitForFile(filePath, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return;
    await driver.sleep(250);
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

async function assertNoStackedAreaTimeline(context) {
  const areaCurves = await driver.executeScript(() => document.querySelectorAll(".recharts-area-area").length);
  if (areaCurves !== 0) {
    throw new Error(context + " rendered " + areaCurves + " stacked area curve(s); history/snapshot breakdowns must be unstacked line charts");
  }
}

async function assertVisibleNativeLineCharts(context, minimumCharts = 1) {
  const stats = await driver.executeScript(() => {
    const charts = [...document.querySelectorAll(".native-line-chart")].map((chart) => {
      const rect = chart.getBoundingClientRect();
      const paths = [...chart.querySelectorAll(".native-line-path")].map((path) => {
        const box = path.getBoundingClientRect();
        const style = getComputedStyle(path);
        return { width: box.width, height: box.height, stroke: style.stroke || path.getAttribute("stroke") || "" };
      });
      const dots = [...chart.querySelectorAll(".native-line-dot")].map((dot) => {
        const box = dot.getBoundingClientRect();
        const style = getComputedStyle(dot);
        return { width: box.width, height: box.height, fill: style.fill || dot.getAttribute("fill") || "" };
      });
      const visiblePaths = paths.filter((item) => item.width >= 1 && item.height >= 1 && !/transparent|none|rgba\(0, 0, 0, 0\)/.test(item.stroke));
      const visibleDots = dots.filter((item) => item.width >= 4 && item.height >= 4 && !/transparent|none|rgba\(0, 0, 0, 0\)/.test(item.fill));
      return { width: rect.width, height: rect.height, paths: paths.length, visiblePaths: visiblePaths.length, dots: dots.length, visibleDots: visibleDots.length };
    });
    return { total: charts.length, usable: charts.filter((chart) => chart.width > 100 && chart.height > 120 && (chart.visiblePaths > 0 || chart.visibleDots > 0)).length, charts };
  });
  if (stats.total < minimumCharts || stats.usable < minimumCharts) {
    throw new Error(context + " did not render usable native line charts: " + JSON.stringify(stats));
  }
}

async function assertNoFakeChartRows(context) {
  const bad = await driver.executeScript(() => {
    const axisCount = document.querySelectorAll(".ranking-axis").length;
    const fakeRankRows = [...document.querySelectorAll(".ranking-row, .metric-bar-row")].filter((row) => {
      const first = row.textContent.trim().split(/\n+/).map((item) => item.trim()).filter(Boolean)[0];
      return first === "0";
    }).map((row) => row.textContent.trim().slice(0, 120));
    return { axisCount, fakeRankRows };
  });
  if (bad.axisCount > 0 || bad.fakeRankRows.length > 0) {
    throw new Error(context + " rendered fake chart axis/rank rows: " + JSON.stringify(bad));
  }
}

async function assertNoChartRowOverlap(context) {
  const bad = await driver.executeScript(() => {
    const overlaps = [];
    for (const row of document.querySelectorAll(".ranking-row, .metric-bar-row")) {
      const label = row.querySelector(".ranking-label, .metric-bar-label");
      const value = row.querySelector(".ranking-value-block, .metric-bar-value");
      if (!label || !value) continue;
      const a = label.getBoundingClientRect();
      const b = value.getBoundingClientRect();
      const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      if (overlapX > 2 && overlapY > 2) overlaps.push(row.textContent.trim().slice(0, 160));
    }
    return overlaps.slice(0, 5);
  });
  if (bad.length > 0) throw new Error(context + " rendered overlapping chart row label/value blocks: " + JSON.stringify(bad));
}

async function assertVisibleChartBars(context) {
  const stats = await driver.executeScript(() => {
    const fills = [...document.querySelectorAll(".metric-bar-track span, .ranking-fill")].map((fill) => {
      const rect = fill.getBoundingClientRect();
      const style = getComputedStyle(fill);
      return { width: rect.width, height: rect.height, background: style.backgroundColor || style.background };
    });
    const visible = fills.filter((item) => item.width >= 3 && item.height >= 10 && !/rgba\(0, 0, 0, 0\)|transparent/.test(item.background));
    return { total: fills.length, visible: visible.length, sample: fills.slice(0, 5) };
  });
  if (stats.total === 0 || stats.visible !== stats.total) {
    throw new Error(context + " did not render visible chart bars: " + JSON.stringify(stats));
  }
}

async function assertNativeLineTooltip(context) {
  let lastStats = {};
  try {
    await driver.wait(async () => {
      lastStats = await driver.executeScript(() => {
        const dot = document.querySelector(".native-line-chart .native-line-dot");
        if (!dot) return { hasDot: false };
        for (const name of ["pointerover", "pointerenter", "mouseover", "mouseenter"]) {
          const event = name.startsWith("pointer") && typeof PointerEvent === "function" ? new PointerEvent(name, { bubbles: true, pointerType: "mouse" }) : new MouseEvent(name, { bubbles: true });
          dot.dispatchEvent(event);
        }
        dot.focus();
        const tooltip = document.querySelector(".native-line-tooltip");
        return { hasDot: true, hasTooltip: Boolean(tooltip), text: tooltip?.textContent?.trim() ?? "" };
      });
      return Boolean(lastStats.hasDot && lastStats.hasTooltip && /[0-9₹$]/.test(lastStats.text));
    }, 5000);
  } catch {
    throw new Error(context + " did not expose a native line tooltip with values: " + JSON.stringify(lastStats));
  }
}

async function assertFrozenRankingVisibility(context) {
  const stats = await driver.executeScript(() => {
    const cards = [...document.querySelectorAll(".frozen-ranking-charts .chart-card")];
    const rows = [...document.querySelectorAll(".frozen-ranking-charts .ranking-row")].map((row) => {
      const rowRect = row.getBoundingClientRect();
      const value = row.querySelector(".ranking-value-block");
      const fill = row.querySelector(".ranking-fill");
      const valueRect = value?.getBoundingClientRect();
      const fillRect = fill?.getBoundingClientRect();
      return {
        text: row.textContent.trim(),
        rowWidth: rowRect.width,
        valueWidth: valueRect?.width ?? 0,
        fillWidth: fillRect?.width ?? 0,
        valueVisible: Boolean(valueRect && valueRect.width >= 80 && valueRect.right <= rowRect.right + 2),
        fillVisible: Boolean(fillRect && fillRect.width >= 3 && fillRect.height >= 10)
      };
    });
    return { cards: cards.length, rows: rows.length, bad: rows.filter((row) => !row.valueVisible || !row.fillVisible).slice(0, 5) };
  });
  if (stats.cards < 2 || stats.rows < 2 || stats.bad.length > 0) {
    throw new Error(context + " rendered hidden frozen ranking values/bars: " + JSON.stringify(stats));
  }
}

async function assertVisibleAllocationDonut(context) {
  const stats = await driver.executeScript(() => {
    const frame = document.querySelector(".allocation-donut-frame");
    const sectors = [...document.querySelectorAll(".allocation-donut-frame .allocation-donut-sector")].map((sector) => {
      const rect = sector.getBoundingClientRect();
      const style = getComputedStyle(sector);
      return { width: rect.width, height: rect.height, fill: style.fill || sector.getAttribute("fill") || "" };
    });
    const center = document.querySelector(".allocation-donut-center")?.textContent?.trim() ?? "";
    const legendRows = [...document.querySelectorAll(".allocation-legend-row")].map((row) => row.textContent.trim());
    const visible = sectors.filter((item) => item.width >= 12 && item.height >= 12 && !/rgba\(0, 0, 0, 0\)|transparent|none/.test(item.fill));
    return { hasFrame: Boolean(frame), total: sectors.length, visible: visible.length, center, legendRows };
  });
  if (!stats.hasFrame || stats.total === 0 || stats.visible !== stats.total || !stats.center.includes("Total") || stats.legendRows.length === 0) {
    throw new Error(context + " did not render a usable allocation donut: " + JSON.stringify(stats));
  }
}

try {
  await driver.get(url);
  await driver.wait(until.elementLocated(By.css("h1")), 15000);
  const title = await driver.findElement(By.css("h1")).getText();
  if (!/Portfolio Analytics|Holdings|Transactions|Goals|Snapshots|Add Entry|Imports|Backup/.test(title)) {
    throw new Error(`Unexpected page heading: ${title}`);
  }
  for (const label of ["Overview", "Allocation", "History"]) {
    await jsClick(`//button[.//strong[normalize-space(.)='${label}']]`);
    await driver.wait(async () => {
      const body = (await driver.findElement(By.css("body")).getText()).toLowerCase();
      if (label === "Overview") return body.includes("current allocation explorer");
      if (label === "Allocation") return body.includes("allocation map") && body.includes("by asset type");
      return body.includes("historical charts reconstruct") && body.includes("portfolio growth");
    }, 15000);
  }
  await jsClick("//button[contains(., 'Imports')]");
  await waitForBodyText("Native File Intake");
  await jsClick("//button[normalize-space(.)='Stage and Commit']");
  await waitForBodyText("Manual CSV committed");
  await jsClick("//button[contains(., 'Add Entry')]");
  await waitForBodyText("Add a transaction or balance snapshot");
  const amountInput = await driver.wait(until.elementLocated(By.xpath("//label[span[normalize-space(.)='Amount']]//input")), 15000);
  await amountInput.clear();
  await amountInput.sendKeys("250");
  await jsClick("//section[.//h2[normalize-space(.)='Add Entry']]//button[contains(., 'Add Entry')]");
  await waitForBodyText("Added Deposit / Contribution for Cash Wallet");
  await jsClick("//button[contains(., 'Transactions')]");
  await driver.wait(async () => {
    const body = (await driver.findElement(By.css("body")).getText()).toLowerCase();
    return body.includes("deposit") && body.includes("manual_entry") && body.includes("250");
  }, 15000);
  await jsClick("//button[contains(., 'Edit Transactions')]");
  await jsClick("//button[normalize-space(.)='Delete']");
  await waitForBodyText("Transaction deleted locally");
  await jsClick("//button[contains(., 'Holdings')]");
  await waitForBodyText("XIRR Coverage");
  await driver.wait(async () => {
    const body = await driver.findElement(By.css("body")).getText();
    return body.includes("Cash Wallet") && body.includes("₹10,000.00") && !body.includes("₹10,250.00");
  }, 15000);
  await driver.wait(async () => {
    const body = (await driver.findElement(By.css("body")).getText()).toLowerCase();
    return body.includes("xirr coverage") && body.includes("top holding xirr") && body.includes("sort by xirr");
  }, 15000);

  await jsClick("//button[contains(., 'Reset')]");
  await waitForBodyText("Portfolio reset locally");
  await jsClick("//button[contains(., 'Imports')]");
  const nativeFileInput = await driver.wait(until.elementLocated(By.xpath("(//input[@type='file'])[1]")), 15000);
  await nativeFileInput.sendKeys(path.resolve("fixtures/importable/manual-balance-ledger-sample.csv"));
  await waitForBodyText("parse the manual CSV");
  await jsClick("//button[normalize-space(.)='Parse Manual CSV']");
  await waitForBodyText("Manual CSV committed: 5 holding(s), 33 transaction(s)", 30000);
  await jsClick("//button[contains(., 'Analytics')]");
  await jsClick("//button[.//strong[normalize-space(.)='Overview']]");
  await driver.wait(async () => {
    const body = await driver.findElement(By.css("body")).getText();
    return body.includes("₹8,940.00") && body.includes("₹8,730.00") && body.includes("₹210.00");
  }, 20000);
  await waitForBodyText("Valuation Quality", 15000);
  await waitForBodyText("Return Engine", 15000);
  await waitForBodyText("Allocation Balance", 15000);
  await jsClick("//button[.//strong[normalize-space(.)='History']]");
  await waitForBodyText("Unstacked month-end value lines", 20000);
  await waitForBodyText("not a stacked position", 20000);
  await assertNoStackedAreaTimeline("history breakdown timelines");
  await assertVisibleNativeLineCharts("history native timelines", 5);
  await assertNativeLineTooltip("history native timeline tooltip");

  await jsClick("//button[contains(., 'Add Entry')]");
  await waitForBodyText("Add Goal");
  await jsClick("//section[.//h2[normalize-space(.)='Add Goal']]//button[contains(., 'Add Goal')]");
  await waitForBodyText("Goal added locally");
  await jsClick("//button[contains(., 'Goals')]");
  await waitForBodyText("Selected goal snapshot");
  await waitForBodyText("Goal snapshot");
  await waitForBodyText("Target corpus");
  await jsClick("//section[.//h2[normalize-space(.)='Map Assets to Goals']]//button[contains(., 'Save Mapping')]");
  await waitForBodyText("Asset mapped to goal locally");
  await driver.wait(async () => {
    const body = (await driver.findElement(By.css("body")).getText()).toLowerCase();
    return body.includes("retirement") && body.includes("needed today") && body.includes("combined goals") && body.includes("map assets to goals");
  }, 15000);
  await jsClick("//button[contains(., 'Analytics')]");
  await waitForBodyText("Analytics scope");
  await jsClick("//button[.//strong[normalize-space(.)='Allocation']]");
  await waitForBodyText("By Asset Type");
  await assertVisibleAllocationDonut("allocation map");
  await assertNoFakeChartRows("allocation metric rows");
  await assertNoChartRowOverlap("allocation metric rows");
  await assertVisibleChartBars("allocation metric rows");
  await jsClick("//button[.//strong[normalize-space(.)='Asset Classes']]");
  await waitForBodyText("Asset class command center");
  await assertNoFakeChartRows("asset class ranking rows");
  await assertNoChartRowOverlap("asset class ranking rows");
  await assertVisibleChartBars("asset class ranking rows");
  await jsClick("//button[.//strong[normalize-space(.)='Combined Goals']]");
  await waitForBodyText("Combined goal analytics");
  await driver.wait(async () => {
    const body = (await driver.findElement(By.css("body")).getText()).toLowerCase();
    return body.includes("mapped holding(s) with dated cash flows") && !body.includes("mapped holding xirr coverage");
  }, 15000);
  await jsClick("//button[.//strong[normalize-space(.)='Retirement']]");
  await waitForBodyText("Goal analytics");
  await jsClick("//button[contains(., 'Snapshots')]");
  await waitForBodyText("Frozen portfolio archive");
  await jsClick("//button[contains(., 'Take Snapshot')]");
  await waitForBodyText("Snapshot captured locally");
  await jsClick("//button[contains(., 'Take Snapshot')]");
  await waitForBodyText("Snapshot captured locally");
  await waitForBodyText("Snapshot Library");
  await waitForBodyText("No market fetch");
  await waitForBodyText("Frozen snapshot history uses only saved snapshot analytics", 20000);
  await assertNoStackedAreaTimeline("snapshot frozen timelines");
  await assertVisibleNativeLineCharts("snapshot frozen timelines", 4);
  await assertNativeLineTooltip("snapshot frozen timeline tooltip");
  await assertFrozenRankingVisibility("snapshot frozen ranking rows");
  await jsClick("//button[contains(., 'Export')]");
  await waitForFile(backupDownloadPath, 20000);
  const exported = JSON.parse(fs.readFileSync(backupDownloadPath, "utf8"));
  if (!Array.isArray(exported.goals) || exported.goals.length !== 1 || !Array.isArray(exported.goalMappings) || exported.goalMappings.length !== 1) {
    throw new Error("Exported JSON did not include the browser-created goal and mapping");
  }
  if (!Array.isArray(exported.snapshots) || exported.snapshots.length < 2 || !exported.snapshots[0].analytics?.timelinePoint?.netWorth) {
    throw new Error("Exported JSON did not include the browser-created frozen snapshot analytics");
  }
  await jsClick("//button[contains(., 'Reset')]");
  await waitForBodyText("Portfolio reset locally");
  await jsClick("//button[contains(., 'Backup')]");
  const restoreInput = await driver.wait(until.elementLocated(By.xpath("//input[@type='file' and contains(@accept, 'application/json')]")), 15000);
  await restoreInput.sendKeys(backupDownloadPath);
  await waitForBodyText("Restored 5 balance record(s) from backup");
  await jsClick("//button[contains(., 'Goals')]");
  await driver.wait(async () => {
    const body = (await driver.findElement(By.css("body")).getText()).toLowerCase();
    return body.includes("retirement") && body.includes("needed today") && body.includes("combined goals") && body.includes("map assets to goals");
  }, 15000);
  await jsClick("//button[contains(., 'Analytics')]");
  await waitForBodyText("Analytics scope");
  await jsClick("//button[.//strong[normalize-space(.)='Combined Goals']]");
  await waitForBodyText("Combined goal analytics");
  await jsClick("//button[contains(., 'Snapshots')]");
  await driver.wait(async () => {
    const body = (await driver.findElement(By.css("body")).getText()).toLowerCase();
    return body.includes("snapshot library") && body.includes("no market fetch") && body.includes("snapshot history");
  }, 15000);
  await waitForBodyText("Frozen snapshot history uses only saved snapshot analytics", 20000);
  await assertNoStackedAreaTimeline("restored snapshot frozen timelines");
  await assertVisibleNativeLineCharts("restored snapshot frozen timelines", 4);
  await assertNativeLineTooltip("restored snapshot frozen timeline tooltip");

  const fidelityCsvPath = path.resolve("test-results/manual-fidelity-smoke.csv");
  fs.writeFileSync(fidelityCsvPath, [
    "transaction_id,date,platform,asset_type,symbol_or_isin,name,type,quantity,price ($),USD-INR,fees,taxes,currency,category,notes",
    "1,15-02-2025,Fidelity,us_stock,TST,Example US Stock,buy,10,10,80,0,,USD,Equity,RSU1",
    "2,15-05-2025,Fidelity,us_stock,TST,Example US Stock,buy,5,12,81,0,,USD,Equity,RSU2",
    "3,28-05-2026,Fidelity,us_stock,TST,Example US Stock,sell,3,30,90,0,,USD,Equity,RSU1"
  ].join("\n"));
  await jsClick("//button[contains(., 'Reset')]");
  await waitForBodyText("Portfolio reset locally");
  await jsClick("//button[contains(., 'Imports')]");
  const fidelityFileInput = await driver.wait(until.elementLocated(By.xpath("(//input[@type='file'])[1]")), 15000);
  await fidelityFileInput.sendKeys(fidelityCsvPath);
  await waitForBodyText("parse the manual CSV");
  await jsClick("//button[normalize-space(.)='Parse Manual CSV']");
  await waitForBodyText("Manual CSV committed: 1 holding(s), 3 transaction(s)", 30000);
  await jsClick("//button[contains(., 'Holdings')]");
  await driver.wait(async () => {
    const body = await driver.findElement(By.css("body")).getText();
    return body.includes("Example US Stock") && body.includes("Direct Stock") && body.toLowerCase().includes("price") && body.includes("$30.00") && body.includes("12");
  }, 20000);
  await assertNoFakeChartRows("holding ranking rows");
  await assertNoChartRowOverlap("holding ranking rows");
  await assertVisibleChartBars("holding ranking rows");
  await jsClick("//button[contains(., 'Analytics')]");
  await jsClick("//button[.//strong[normalize-space(.)='Overall']]");
  await jsClick("//button[.//strong[normalize-space(.)='Asset Classes']]");
  await waitForBodyText("Direct stocks", 15000);
  await assertNoFakeChartRows("direct stock asset class ranking rows");
  await assertNoChartRowOverlap("direct stock asset class ranking rows");
  await assertVisibleChartBars("direct stock asset class ranking rows");
  fs.writeFileSync(screenshotPath, await driver.takeScreenshot(), "base64");
  console.log(`Selenium smoke passed: ${title}`);
  console.log(`Screenshot: ${screenshotPath}`);
} catch (error) {
  try {
    fs.writeFileSync(screenshotPath.replace(/\.png$/, "-failed.png"), await driver.takeScreenshot(), "base64");
    console.error(await driver.findElement(By.css("body")).getText());
  } catch {}
  throw error;
} finally {
  await Promise.race([
    driver.quit(),
    new Promise((resolve) => setTimeout(resolve, 3000))
  ]);
}

process.exit(0);
