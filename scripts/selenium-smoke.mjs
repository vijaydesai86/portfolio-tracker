import fs from "node:fs";
import path from "node:path";
import { Builder, Browser, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";

const url = process.env.APP_URL ?? "http://localhost:3000";
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
  await driver.executeScript("arguments[0].click();", element);
}

async function navClick(label) {
  const buttons = await driver.findElements(By.css(".app-shell-v2 .nav button"));
  for (const button of buttons) {
    const text = (await button.getText()).trim();
    if (!(text === label || text.includes(label))) continue;
    if (!(await button.isDisplayed())) continue;
    await driver.executeScript("arguments[0].scrollIntoView({block: 'center', inline: 'center'});", button);
    await driver.sleep(120);
    await button.click();
    await driver.sleep(350);
    return;
  }
  throw new Error("Navigation button not found: " + label);
}
async function waitForBodyText(text, timeout = 15000) {
  const started = Date.now();
  let sample = "";
  while (Date.now() - started < timeout) {
    sample = String(await driver.executeScript("return document.body ? document.body.textContent : '';"));
    if (sample.toLowerCase().includes(text.toLowerCase())) return;
    await driver.sleep(150);
  }
  throw new Error(`Timed out waiting for body text: ${text}. Sample: ${sample.slice(0, 500)}`);
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

async function assertInteractiveTables(context) {
  const stats = await driver.executeScript(() => {
    const wraps = [...document.querySelectorAll(".table-wrap")].filter((wrap) => wrap.querySelector("table tbody tr:nth-child(2)"));
    const sortable = wraps.filter((wrap) => wrap.classList.contains("interactive-table-wrap") && wrap.querySelector("th.sortable-column"));
    if (wraps.length === 0) return { wraps: 0, sortable: 0, sorted: true, hinted: true };
    const target = sortable[0];
    if (!target) return { wraps: wraps.length, sortable: 0, sorted: false, hinted: false };
    const header = target.querySelector("th.sortable-column");
    const hinted = Boolean(target.previousElementSibling?.classList.contains("table-interaction-hint"));
    header.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const sorted = header.getAttribute("aria-sort") === "ascending" || header.getAttribute("aria-sort") === "descending";
    return { wraps: wraps.length, sortable: sortable.length, sorted, hinted };
  });
  if (stats.wraps > 0 && (stats.sortable < 1 || !stats.sorted || !stats.hinted)) {
    throw new Error(context + " did not provide sortable interactive tables: " + JSON.stringify(stats));
  }
}

async function assertFinanceTablesReadable(context) {
  const stats = await driver.executeScript(() => {
    const tables = [...document.querySelectorAll(".tax-workspace table, .data-audit-workspace table")];
    const badCells = [];
    const badScrollers = [];
    for (const table of tables) {
      const wrap = table.closest(".table-wrap");
      if (!wrap) {
        badScrollers.push("missing table-wrap");
        continue;
      }
      const wrapRect = wrap.getBoundingClientRect();
      const tableRect = table.getBoundingClientRect();
      const pageWidth = document.documentElement.clientWidth;
      const wrapStyle = getComputedStyle(wrap);
      const scrollableWhenWide = table.scrollWidth <= wrap.clientWidth + 4 || /(auto|scroll)/.test(wrapStyle.overflowX + wrapStyle.overflow);
      if (wrapRect.left < -4 || wrapRect.right > pageWidth + 4) badScrollers.push("table-wrap escapes viewport");
      if (!scrollableWhenWide) badScrollers.push("wide table is not internally scrollable");
      if (tableRect.width > pageWidth && wrapRect.width > pageWidth + 4) badScrollers.push("wide table expands the page instead of its scroller");
      for (const cell of table.querySelectorAll("td, th")) {
        const style = getComputedStyle(cell);
        const text = cell.textContent.trim();
        if (!/[0-9₹$%-]/.test(text)) continue;
        if (style.whiteSpace !== "nowrap" && cell.cellIndex !== 0 && !cell.closest(".analytics-grid")) {
          badCells.push({ text: text.slice(0, 60), whiteSpace: style.whiteSpace, wordBreak: style.wordBreak, overflowWrap: style.overflowWrap });
        }
        if (style.wordBreak !== "normal") {
          badCells.push({ text: text.slice(0, 60), whiteSpace: style.whiteSpace, wordBreak: style.wordBreak, overflowWrap: style.overflowWrap });
        }
      }
    }
    return { tables: tables.length, badCells: badCells.slice(0, 8), badScrollers: badScrollers.slice(0, 8) };
  });
  if (stats.badCells.length > 0 || stats.badScrollers.length > 0) {
    throw new Error(context + " rendered unreadable finance tables: " + JSON.stringify(stats));
  }
}

async function assertCardsContained(context) {
  const stats = await driver.executeScript(() => {
    const pageWidth = document.documentElement.clientWidth;
    const bad = [...document.querySelectorAll(".card, .chart-card")].map((element) => {
      const rect = element.getBoundingClientRect();
      return { text: element.textContent.trim().slice(0, 80), left: rect.left, right: rect.right, width: rect.width };
    }).filter((item) => item.width > 0 && (item.left < -4 || item.right > pageWidth + 4)).slice(0, 8);
    return { bad };
  });
  if (stats.bad.length > 0) {
    throw new Error(context + " rendered escaping cards: " + JSON.stringify(stats));
  }
}

async function assertGoalsReadable(context) {
  const stats = await driver.executeScript(() => {
    const pageWidth = document.documentElement.clientWidth;
    const bad = [];
    const overlapPairs = [];
    for (const element of document.querySelectorAll(".goals-section .mini-insight, .goal-card, .goal-selector-control, .goal-mapping-row")) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && (rect.left < -4 || rect.right > pageWidth + 4)) {
        bad.push({ text: element.textContent.trim().slice(0, 80), left: rect.left, right: rect.right, width: rect.width });
      }
    }
    for (const insight of document.querySelectorAll(".goals-section .mini-insight")) {
      const children = [...insight.children].filter((child) => child.getBoundingClientRect().width > 0 && child.getBoundingClientRect().height > 0);
      for (let i = 0; i < children.length; i += 1) {
        for (let j = i + 1; j < children.length; j += 1) {
          const a = children[i].getBoundingClientRect();
          const b = children[j].getBoundingClientRect();
          const overlapX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
          const overlapY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
          if (overlapX > 2 && overlapY > 2) overlapPairs.push(insight.textContent.trim().slice(0, 100));
        }
      }
    }
    return { bad: bad.slice(0, 8), overlapPairs: overlapPairs.slice(0, 8) };
  });
  if (stats.bad.length > 0 || stats.overlapPairs.length > 0) {
    throw new Error(context + " rendered unreadable goal metrics: " + JSON.stringify(stats));
  }
}


async function assertAssetCommandMetricContrast(context) {
  const stats = await driver.executeScript(() => {
    function parseRgb(value) {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
      if (parts.length < 3 || parts.some((part, index) => index < 3 && !Number.isFinite(part))) return null;
      return { r: parts[0], g: parts[1], b: parts[2] };
    }
    function luminance(rgb) {
      const values = [rgb.r, rgb.g, rgb.b].map((value) => {
        const channel = value / 255;
        return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
      });
      return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
    }
    function contrast(a, b) {
      const l1 = luminance(a);
      const l2 = luminance(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    }
    const bad = [];
    const checked = [];
    for (const element of document.querySelectorAll(".asset-type-hero-metrics .mini-insight span, .asset-type-hero-metrics .mini-insight strong, .asset-type-hero-metrics .mini-insight small")) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const tile = element.closest(".mini-insight");
      const fg = parseRgb(getComputedStyle(element).color);
      const bg = parseRgb(getComputedStyle(tile).backgroundColor);
      if (!fg || !bg) {
        bad.push({ text: element.textContent.trim(), fg: getComputedStyle(element).color, bg: getComputedStyle(tile).backgroundColor, reason: "unparsed color" });
        continue;
      }
      const ratio = contrast(fg, bg);
      checked.push({ text: element.textContent.trim().slice(0, 40), ratio });
      if (ratio < 4.5) bad.push({ text: element.textContent.trim().slice(0, 80), ratio, fg: getComputedStyle(element).color, bg: getComputedStyle(tile).backgroundColor });
    }
    return { checked: checked.length, bad: bad.slice(0, 8) };
  });
  if (stats.checked < 6 || stats.bad.length > 0) {
    throw new Error(context + " rendered low-contrast asset command metrics: " + JSON.stringify(stats));
  }
}


async function assertActiveSelectorContrast(context) {
  const stats = await driver.executeScript(() => {
    function parseRgb(value) {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
      if (parts.length < 3 || parts.some((part, index) => index < 3 && !Number.isFinite(part))) return null;
      return { r: parts[0], g: parts[1], b: parts[2] };
    }
    function luminance(rgb) {
      const values = [rgb.r, rgb.g, rgb.b].map((value) => {
        const channel = value / 255;
        return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
      });
      return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
    }
    function contrast(a, b) {
      const l1 = luminance(a);
      const l2 = luminance(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    }
    const bad = [];
    const checked = [];
    for (const element of document.querySelectorAll(".analytics-scope-control button.active strong, .analytics-scope-control button.active span, .analytics-tabs button.active strong, .analytics-tabs button.active span")) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const button = element.closest("button");
      const fg = parseRgb(getComputedStyle(element).color);
      const bg = parseRgb(getComputedStyle(button).backgroundColor);
      if (!fg || !bg) {
        bad.push({ text: element.textContent.trim().slice(0, 60), fg: getComputedStyle(element).color, bg: getComputedStyle(button).backgroundColor, reason: "unparsed color" });
        continue;
      }
      const ratio = contrast(fg, bg);
      checked.push({ text: element.textContent.trim().slice(0, 60), ratio });
      if (ratio < 3.5) bad.push({ text: element.textContent.trim().slice(0, 60), ratio, fg: getComputedStyle(element).color, bg: getComputedStyle(button).backgroundColor });
    }
    return { checked: checked.length, bad: bad.slice(0, 8) };
  });
  if (stats.checked < 4 || stats.bad.length > 0) {
    throw new Error(context + " rendered unreadable active selector text: " + JSON.stringify(stats));
  }
}

async function assertHeadingVisualHierarchy(context) {
  const stats = await driver.executeScript(() => {
    function weightNumber(value) {
      if (value === "bold") return 700;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : 400;
    }
    const bad = [];
    for (const element of document.querySelectorAll("h1, h2, h3, .panel-heading span")) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const style = getComputedStyle(element);
      const size = Number.parseFloat(style.fontSize);
      const weight = weightNumber(style.fontWeight);
      const tag = element.tagName.toLowerCase();
      const minSize = tag === "h1" ? 20 : tag === "h2" ? 15 : 14;
      if (size < minSize || weight < 650) {
        bad.push({ text: element.textContent.trim().slice(0, 80), tag, size, weight });
      }
    }
    return { bad: bad.slice(0, 8) };
  });
  if (stats.bad.length > 0) {
    throw new Error(context + " rendered weak heading hierarchy: " + JSON.stringify(stats));
  }
}


async function assertSemanticHeadingRelations(context) {
  const stats = await driver.executeScript(() => {
    function num(styleValue) {
      const parsed = Number.parseFloat(styleValue);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    function weight(styleValue) {
      if (styleValue === "bold") return 700;
      const parsed = Number.parseInt(styleValue, 10);
      return Number.isFinite(parsed) ? parsed : 400;
    }
    function metrics(element) {
      const style = getComputedStyle(element);
      return { text: element.textContent.trim().slice(0, 80), size: num(style.fontSize), weight: weight(style.fontWeight) };
    }
    const bad = [];
    for (const card of document.querySelectorAll(".asset-type-card")) {
      const primary = card.querySelector(".asset-type-card-head > div > span");
      const nested = [...card.querySelectorAll(".asset-type-card-charts h3")];
      if (!primary || nested.length === 0) continue;
      const p = metrics(primary);
      const maxNested = nested.map(metrics).sort((a, b) => b.size - a.size)[0];
      if (p.size < maxNested.size + 4 || p.weight < maxNested.weight) {
        bad.push({ kind: "asset-card", primary: p, nested: maxNested });
      }
    }
    for (const section of document.querySelectorAll(".command-hero, .analytics-scope-panel, .asset-type-hero, .snapshot-command-panel, .goal-focus-panel, .goal-combined-panel")) {
      const primary = section.querySelector(":scope .eyebrow");
      const label = section.querySelector(":scope .mini-insight > span, :scope button span, :scope .metric-label");
      if (!primary || !label) continue;
      const p = metrics(primary);
      const l = metrics(label);
      if (p.size < l.size + 3 || p.weight < l.weight) {
        bad.push({ kind: "section-eyebrow", primary: p, nested: l });
      }
    }
    for (const card of document.querySelectorAll(".card, .chart-card")) {
      const primary = card.querySelector(":scope > .section-head h2, :scope > h2");
      const label = card.querySelector(":scope .mini-insight > span, :scope .metric-label");
      if (!primary || !label) continue;
      const p = metrics(primary);
      const l = metrics(label);
      if (p.size < l.size + 2 || p.weight < l.weight) {
        bad.push({ kind: "card", primary: p, nested: l });
      }
    }
    for (const goalCard of document.querySelectorAll(".goal-card")) {
      const primary = goalCard.querySelector(".goal-card-head input");
      const label = goalCard.querySelector(".mini-insight > span");
      if (!primary || !label) continue;
      const p = metrics(primary);
      const l = metrics(label);
      if (p.size < l.size + 6 || p.weight < l.weight) {
        bad.push({ kind: "goal-card", primary: p, nested: l });
      }
    }
    return { bad: bad.slice(0, 12) };
  });
  if (stats.bad.length > 0) {
    throw new Error(context + " rendered inverted section/subsection hierarchy: " + JSON.stringify(stats));
  }
}

async function assertCollapsibleSections(context) {
  await driver.wait(async () => await driver.executeScript(() => document.querySelectorAll(".collapse-toggle").length > 0), 5000);
  const stats = await driver.executeScript(() => {
    const toggles = [...document.querySelectorAll(".collapse-toggle")].filter((button) => {
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && button.closest(".collapsible-section");
    });
    const textLabeled = toggles.filter((button) => /expand|collapse/i.test(button.textContent.trim())).map((button) => button.textContent.trim());
    const missingState = toggles.filter((button) => !button.dataset.state || !button.getAttribute("aria-expanded") || !button.getAttribute("aria-label")).length;
    const oversized = toggles.filter((button) => {
      const rect = button.getBoundingClientRect();
      return rect.width > 42 || rect.height > 42;
    }).length;
    if (toggles.length === 0) return { count: 0, textLabeled, missingState, oversized };
    const button = toggles[0];
    const section = button.closest(".collapsible-section");
    if (section.classList.contains("is-collapsed")) button.click();
    const before = section.getBoundingClientRect().height;
    button.click();
    const collapsed = section.classList.contains("is-collapsed") && button.getAttribute("aria-expanded") === "false" && button.dataset.state === "collapsed";
    const afterCollapse = section.getBoundingClientRect().height;
    button.click();
    const expanded = !section.classList.contains("is-collapsed") && button.getAttribute("aria-expanded") === "true" && button.dataset.state === "expanded";
    const afterExpand = section.getBoundingClientRect().height;
    return { count: toggles.length, collapsed, expanded, before, afterCollapse, afterExpand, textLabeled, missingState, oversized };
  });
  if (stats.count < 1 || !stats.collapsed || !stats.expanded || stats.textLabeled.length > 0 || stats.missingState > 0 || stats.oversized > 0) {
    throw new Error(context + " did not provide chevron-only working disclosure controls: " + JSON.stringify(stats));
  }
}

async function assertSubsectionCollapsibleSections(context) {
  const stats = await driver.executeScript(() => {
    const toggles = [...document.querySelectorAll(".asset-type-card-charts > div.collapsible-section > .collapse-toggle")].filter((button) => {
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const textLabeled = toggles.filter((button) => /expand|collapse/i.test(button.textContent.trim())).map((button) => button.textContent.trim());
    if (toggles.length === 0) return { count: 0, textLabeled };
    const button = toggles[0];
    const section = button.closest(".collapsible-section");
    if (section.classList.contains("is-collapsed")) button.click();
    button.click();
    const collapsed = section.classList.contains("is-collapsed") && button.dataset.state === "collapsed" && button.getAttribute("aria-expanded") === "false";
    button.click();
    const expanded = !section.classList.contains("is-collapsed") && button.dataset.state === "expanded" && button.getAttribute("aria-expanded") === "true";
    return { count: toggles.length, collapsed, expanded, textLabeled };
  });
  if (stats.count < 3 || !stats.collapsed || !stats.expanded || stats.textLabeled.length > 0) {
    throw new Error(context + " did not provide subsection chevron disclosure controls: " + JSON.stringify(stats));
  }
}

async function assertGoalTermTooltips(context) {
  const stats = await driver.executeScript(() => {
    function weightNumber(value) {
      if (value === "bold") return 700;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : 400;
    }
    const labels = [...document.querySelectorAll(".goal-snapshot .term-label")].map((label) => {
      const style = getComputedStyle(label);
      return {
        text: label.textContent.trim(),
        title: label.getAttribute("title") || "",
        aria: label.getAttribute("aria-label") || "",
        weight: weightNumber(style.fontWeight)
      };
    });
    return { count: labels.length, bad: labels.filter((label) => label.title.length < 30 || label.aria.length < 30 || label.weight < 700) };
  });
  if (stats.count < 4 || stats.bad.length > 0) {
    throw new Error(context + " rendered incomplete goal term explanations: " + JSON.stringify(stats));
  }
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
        valueVisible: Boolean(valueRect && valueRect.width >= 36 && valueRect.height >= 12 && valueRect.left >= rowRect.left - 2 && valueRect.right <= rowRect.right + 2),
        fillVisible: Boolean(fillRect && fillRect.width >= 3 && fillRect.height >= 10)
      };
    });
    return { cards: cards.length, rows: rows.length, bad: rows.filter((row) => !row.valueVisible || !row.fillVisible).slice(0, 5) };
  });
  if (stats.cards < 2 || stats.rows < 2 || stats.bad.length > 0) {
    throw new Error(context + " rendered hidden frozen ranking values/bars: " + JSON.stringify(stats));
  }
}

async function assertNoPageOverflow(context) {
  const stats = await driver.executeScript(() => {
    const width = document.documentElement.clientWidth;
    function isContainedScrollableOverflow(element) {
      const scroller = element.closest(".table-wrap, .goal-mapping-list, .nav");
      if (!scroller) return false;
      const scrollerRect = scroller.getBoundingClientRect();
      const style = getComputedStyle(scroller);
      const scrollable = scroller.scrollWidth > scroller.clientWidth + 4 && /(auto|scroll)/.test(style.overflowX + style.overflowY + style.overflow);
      const containerInsidePage = scrollerRect.left >= -4 && scrollerRect.right <= width + 4;
      return scrollable && containerInsidePage;
    }
    const offenders = [...document.querySelectorAll("body *")].map((element) => {
      const rect = element.getBoundingClientRect();
      return { element, tag: element.tagName, cls: element.className?.toString?.() ?? "", text: element.textContent?.trim?.().slice(0, 80) ?? "", left: rect.left, right: rect.right, width: rect.width };
    }).filter((item) => item.width > 0 && (item.left < -4 || item.right > width + 4) && !isContainedScrollableOverflow(item.element)).slice(0, 8).map(({ element, ...item }) => item);
    return { width, offenders };
  });
  if (stats.offenders.length > 0) throw new Error(context + " has horizontal overflow: " + JSON.stringify(stats));
}

async function assertSettingsReachableInSidebar(context) {
  const stats = await driver.executeScript(() => {
    const sidebar = document.querySelector(".app-shell-v2 .sidebar");
    const settingsButton = [...document.querySelectorAll(".app-shell-v2 .nav button")].find((button) => button.textContent.includes("Settings"));
    if (!sidebar || !settingsButton) return { hasSidebar: Boolean(sidebar), hasSettings: Boolean(settingsButton) };
    sidebar.scrollTop = sidebar.scrollHeight;
    const sidebarRect = sidebar.getBoundingClientRect();
    const buttonRect = settingsButton.getBoundingClientRect();
    const style = getComputedStyle(sidebar);
    return {
      hasSidebar: true,
      hasSettings: true,
      scrollHeight: sidebar.scrollHeight,
      clientHeight: sidebar.clientHeight,
      overflowY: style.overflowY,
      settingsTop: buttonRect.top,
      settingsBottom: buttonRect.bottom,
      sidebarTop: sidebarRect.top,
      sidebarBottom: sidebarRect.bottom,
      reachable: buttonRect.bottom <= sidebarRect.bottom + 2 && buttonRect.top >= sidebarRect.top - 2
    };
  });
  if (!stats.hasSidebar || !stats.hasSettings || !stats.reachable || (stats.scrollHeight > stats.clientHeight && !/(auto|scroll)/.test(stats.overflowY))) {
    throw new Error(context + " cannot reach Settings in sidebar: " + JSON.stringify(stats));
  }
}

async function assertResponsiveCorePages() {
  for (const [label, width, height] of [["desktop", 1440, 950], ["laptop", 1280, 800], ["short-laptop", 1366, 680], ["tablet", 980, 900], ["mobile", 390, 860]]) {
    await driver.manage().window().setRect({ width, height });
    await driver.sleep(350);
    if (label === "desktop" || label === "laptop" || label === "short-laptop") await assertSettingsReachableInSidebar(label + " navigation");
    for (const page of ["Overview", "Holdings", "Goals", "Expenses", "Goal Longevity", "Planning", "Tax", "Transactions", "Imports", "Data Quality", "Snapshots", "Manual Entry", "Settings"]) {
      await navClick(page);
      await waitForBodyText(
        page === "Overview" ? "Analytics scope" :
        page === "Data Quality" ? "Data Reconciliation" :
        page === "Planning" ? "Planning Lab" :
        page === "Goal Longevity" ? "Goal Longevity" :
        page === "Expenses" ? "Goal expenses are modeled from detailed line items" :
        page === "Snapshots" ? "Frozen portfolio archive" :
        page === "Manual Entry" ? "Add a transaction or balance snapshot" :
        page,
        15000
      );
      await assertNoPageOverflow(label + " " + page);
      await assertNoChartRowOverlap(label + " " + page + " chart rows");
      await assertCardsContained(label + " " + page + " cards");
      await assertHeadingVisualHierarchy(label + " " + page + " headings");
      await assertSemanticHeadingRelations(label + " " + page + " semantic headings");
      await assertCollapsibleSections(label + " " + page + " collapsible sections");
      await assertFinanceTablesReadable(label + " " + page + " finance tables");
      await assertInteractiveTables(label + " " + page + " interactive tables");
      if (page === "Overview") {
        for (const tab of ["Overview", "Allocation", "Returns", "Risk", "History"]) {
          await jsClick("//button[.//strong[normalize-space(.)='" + tab + "']]");
          await assertNoPageOverflow(label + " Overview " + tab);
          await assertNoChartRowOverlap(label + " Overview " + tab + " chart rows");
          await assertCardsContained(label + " Overview " + tab + " cards");
        }
      }
      if (page === "Goals") await assertGoalsReadable(label + " Goals");
      if (page === "Goal Longevity") {
        await waitForBodyText("Modeled goals", 15000);
      }
      if (page === "Planning") {
        await waitForBodyText("Scenario Planning", 15000);
        await waitForBodyText("Rebalancing View", 15000);
        await waitForBodyText("Goal-level advisory drift", 15000);
        await waitForBodyText("Income Projection", 15000);
      }
      if (page === "Snapshots") await waitForBodyText("Snapshot Library", 15000);
    }
  }
  await driver.manage().window().setRect({ width: 1440, height: 950 });
}


async function assertImportPreviewContained(context) {
  const stats = await driver.executeScript(() => {
    const panel = document.querySelector(".import-preview-panel");
    if (!panel) return { hasPanel: false };
    const card = panel.closest(".card");
    const tableWrap = panel.querySelector(".table-wrap");
    const panelRect = panel.getBoundingClientRect();
    const cardRect = card?.getBoundingClientRect();
    const wrapRect = tableWrap?.getBoundingClientRect();
    const pageWidth = document.documentElement.clientWidth;
    const escapingChildren = [...panel.querySelectorAll(".mini-insight, .table-wrap, table")].map((element) => {
      const rect = element.getBoundingClientRect();
      return { text: element.textContent.trim().slice(0, 80), left: rect.left, right: rect.right, width: rect.width };
    }).filter((item) => item.width > 0 && (item.left < panelRect.left - 4 || item.right > panelRect.right + 4) && !(tableWrap && item.text.includes("Action") && wrapRect && wrapRect.left >= panelRect.left - 4 && wrapRect.right <= panelRect.right + 4));
    const wrapStyle = tableWrap ? getComputedStyle(tableWrap) : null;
    return {
      hasPanel: true,
      panelInsideCard: Boolean(cardRect && panelRect.left >= cardRect.left - 4 && panelRect.right <= cardRect.right + 4),
      panelInsidePage: panelRect.left >= -4 && panelRect.right <= pageWidth + 4,
      hasScroller: Boolean(tableWrap && /(auto|scroll)/.test((wrapStyle?.overflowX ?? "") + (wrapStyle?.overflow ?? ""))),
      wrapInsidePanel: Boolean(wrapRect && wrapRect.left >= panelRect.left - 4 && wrapRect.right <= panelRect.right + 4),
      escapingChildren: escapingChildren.slice(0, 6)
    };
  });
  if (!stats.hasPanel || !stats.panelInsideCard || !stats.panelInsidePage || !stats.hasScroller || !stats.wrapInsidePanel || stats.escapingChildren.length > 0) {
    throw new Error(context + " rendered an overflowing import preview: " + JSON.stringify(stats));
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
  if (!/Portfolio Analytics|Overview|Holdings|Transactions|Goals|Expenses|Goal Longevity|Planning|Tax|Snapshots|Manual Entry|Imports|Data Quality|Settings|Backup/.test(title)) {
    throw new Error(`Unexpected page heading: ${title}`);
  }
  for (const label of ["Overview", "Allocation", "Returns", "Risk", "History"]) {
    await jsClick(`//button[.//strong[normalize-space(.)='${label}']]`);
    await driver.sleep(150);
  }
  await jsClick("//button[.//strong[normalize-space(.)='Overview']]");
  await waitForBodyText("Scope Mix", 15000);
  await navClick("Imports");
  await waitForBodyText("Native File Intake");
  await jsClick("//button[normalize-space(.)='Preview Manual CSV']");
  await waitForBodyText("Import Preview");
  await waitForBodyText("Net worth delta");
  await waitForBodyText("Nothing committed yet");
  await assertImportPreviewContained("manual CSV preview");
  await jsClick("//button[normalize-space(.)='Stage and Commit']");
  await waitForBodyText("Manual CSV committed");
  await navClick("Manual Entry");
  await waitForBodyText("Add a transaction or balance snapshot");
  const amountInput = await driver.wait(until.elementLocated(By.xpath("//label[span[normalize-space(.)='Amount']]//input")), 15000);
  await amountInput.clear();
  await amountInput.sendKeys("250");
  await jsClick("//section[.//h2[normalize-space(.)='Add Entry']]//button[contains(., 'Add Entry')]");
  await waitForBodyText("Added Deposit / Contribution for Cash Wallet");
  await navClick("Transactions");
  await driver.wait(async () => {
    const body = (await driver.findElement(By.css("body")).getText()).toLowerCase();
    return body.includes("deposit") && body.includes("manual_entry") && body.includes("250");
  }, 15000);
  await jsClick("//button[contains(., 'Edit Transactions')]");
  await driver.wait(until.elementLocated(By.xpath("//input[@placeholder='FMV / tax price']")), 15000);
  await jsClick("//button[normalize-space(.)='Delete']");
  await waitForBodyText("Draft transaction delete captured");
  await jsClick("//button[contains(., 'Done Editing')]");
  await waitForBodyText("Draft edits committed locally");
  await navClick("Holdings");
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
  await navClick("Imports");
  const nativeFileInput = await driver.wait(until.elementLocated(By.xpath("(//input[@type='file'])[1]")), 15000);
  await nativeFileInput.sendKeys(path.resolve("fixtures/importable/manual-balance-ledger-sample.csv"));
  await waitForBodyText("parse the manual CSV");
  await jsClick("//button[normalize-space(.)='Parse Manual CSV']");
  await waitForBodyText("Manual CSV committed: 5 holding(s), 33 transaction(s)", 30000);
  await navClick("Overview");
  await jsClick("//button[.//strong[normalize-space(.)='Overview']]");
  await driver.wait(async () => {
    const body = await driver.findElement(By.css("body")).getText();
    return body.includes("₹8,940.00") && body.includes("₹8,730.00") && body.includes("₹210.00");
  }, 20000);
  await waitForBodyText("Planning Value", 15000);
  await waitForBodyText("Return Engine", 15000);
  await waitForBodyText("Tax & Income", 15000);
  await waitForBodyText("Action Checks", 15000);
  await waitForBodyText("Scope Mix", 15000);
  await assertActiveSelectorContrast("overview active scope and tab selectors");
  await jsClick("//button[.//strong[normalize-space(.)='History']]");
  await waitForBodyText("Unstacked month-end value lines", 20000);
  await waitForBodyText("not a stacked position", 20000);
  await assertNoStackedAreaTimeline("history breakdown timelines");
  await assertVisibleNativeLineCharts("history native timelines", 5);
  await assertNativeLineTooltip("history native timeline tooltip");

  await navClick("Tax");
  await waitForBodyText("Portfolio Tax Estimates", 15000);
  await waitForBodyText("Estimated tax", 15000);
  await waitForBodyText("Financial year", 15000);
  await waitForBodyText("Tax Assumptions", 15000);
  await navClick("Data Quality");
  await waitForBodyText("Data Reconciliation", 15000);
  await waitForBodyText("Validation Checks", 15000);
  await waitForBodyText("Market Data Health", 15000);
  await waitForBodyText("Data Quality Matrix", 15000);
  await assertVisibleChartBars("data source value bars");
  await navClick("Settings");
  await waitForBodyText("Tax regime", 15000);
  await waitForBodyText("Resident Indian individual", 15000);
  await waitForBodyText("Planning Assumptions", 15000);

  await navClick("Manual Entry");
  await waitForBodyText("Add Goal");
  await jsClick("//section[.//h2[normalize-space(.)='Add Goal']]//button[contains(., 'Add Goal')]");
  await waitForBodyText("Goal added locally");
  await navClick("Goals");
  await waitForBodyText("Selected goal snapshot");
  await waitForBodyText("Goal snapshot");
  await waitForBodyText("Target corpus");
  await waitForBodyText("Combined", 15000);
  await driver.wait(until.elementLocated(By.css(".goal-include-toggle input[type='checkbox']")), 15000);
  await assertGoalTermTooltips("Goals term tooltips");
  await assertCollapsibleSections("Goals collapse controls");
  await jsClick("//section[.//h2[normalize-space(.)='Map Assets to Goals']]//button[contains(., 'Save Mapping')]");
  await waitForBodyText("Asset mapped to goal locally");
  await driver.wait(async () => {
    const body = (await driver.findElement(By.css("body")).getText()).toLowerCase();
    return body.includes("retirement") && body.includes("needed today") && body.includes("combined goals") && body.includes("map assets to goals");
  }, 15000);
  await navClick("Imports");
  await waitForBodyText("Goal Expense Inputs", 15000);
  await jsClick("//button[contains(., 'Import Goal Expenses')]");
  await waitForBodyText("Imported 3 goal expense row(s)", 15000);
  await navClick("Expenses");
  await waitForBodyText("Goal expenses are modeled from detailed line items", 15000);
  await waitForBodyText("Current monthly", 15000);
  await waitForBodyText("Planning monthly", 15000);
  await waitForBodyText("Current Expense Categories", 15000);
  await waitForBodyText("Current Payer Responsibility", 15000);
  await waitForBodyText("Current Expense Lines", 15000);
  await waitForBodyText("Scenario Playbook", 15000);
  await waitForBodyText("Expense Line Audit", 15000);
  await waitForBodyText("₹1,20,000.00", 15000);
  await assertNoPageOverflow("Expenses page after import");
  await assertCardsContained("Expenses page after import cards");
  await assertFinanceTablesReadable("Expenses page after import tables");
  await navClick("Planning");
  await waitForBodyText("Planning Lab", 15000);
  await waitForBodyText("Scenario Planning", 15000);
  await waitForBodyText("Rebalancing View", 15000);
  await waitForBodyText("Goal-level advisory drift", 15000);
  await waitForBodyText("Income Projection", 15000);
  await waitForBodyText("Performance Attribution", 15000);
  await assertNoPageOverflow("Planning page");
  await navClick("Goal Longevity");
  await waitForBodyText("Goal Longevity", 15000);
  await waitForBodyText("Spend growth %", 15000);
  await waitForBodyText("Corpus consumption years", 15000);
  await waitForBodyText("Withdrawal timing", 15000);
  await assertNoPageOverflow("Goal Longevity page");
  await assertVisibleNativeLineCharts("goal longevity drawdown chart", 1);
  await navClick("Holdings");
  await waitForBodyText("XIRR Coverage", 15000);
  await jsClick("(//button[normalize-space(.)='Details'])[1]");
  await waitForBodyText("Recent Transactions", 15000);
  await waitForBodyText("Goal Mappings", 15000);
  await waitForBodyText("Tax Lots", 15000);
  await assertNoPageOverflow("holding detail drawer");
  await jsClick("//button[normalize-space(.)='Hide details']");
  await navClick("Overview");
  await waitForBodyText("Analytics scope");
  await jsClick("//button[.//strong[normalize-space(.)='Allocation']]");
  await waitForBodyText("By Asset Type");
  await assertVisibleAllocationDonut("allocation map");
  await assertNoFakeChartRows("allocation metric rows");
  await assertNoChartRowOverlap("allocation metric rows");
  await assertVisibleChartBars("allocation metric rows");
  await jsClick("//button[.//strong[normalize-space(.)='Allocation']]");
  await waitForBodyText("Asset class command center");
  await assertAssetCommandMetricContrast("asset class command metrics");
  await assertSubsectionCollapsibleSections("asset class subsection collapse controls");
  await assertNoFakeChartRows("asset class ranking rows");
  await assertNoChartRowOverlap("asset class ranking rows");
  await assertVisibleChartBars("asset class ranking rows");
  await jsClick("//button[.//strong[normalize-space(.)='Combined Goals']]");
  await waitForBodyText("Combined goal analytics");
  await assertActiveSelectorContrast("combined goal active scope selector");
  await driver.wait(async () => {
    const body = (await driver.findElement(By.css("body")).getText()).toLowerCase();
    return body.includes("mapped holding(s) with dated cash flows") && !body.includes("mapped holding xirr coverage");
  }, 15000);
  await jsClick("//button[.//strong[normalize-space(.)='Retirement']]");
  await waitForBodyText("Goal analytics");
  await jsClick("//button[.//strong[normalize-space(.)='History']]");
  await waitForBodyText("Goal history reconstructs", 15000);
  await waitForBodyText("Retirement Growth", 15000);
  await assertVisibleNativeLineCharts("goal scoped history timelines", 3);
  await assertNativeLineTooltip("goal scoped history timeline tooltip");
  await navClick("Snapshots");
  await waitForBodyText("Frozen portfolio archive");
  await jsClick("//button[contains(., 'Take Snapshot')]");
  await waitForBodyText("Snapshot captured locally");
  await jsClick("//button[contains(., 'Take Snapshot')]");
  await waitForBodyText("Snapshot captured locally");
  await waitForBodyText("Snapshot Library");
  await waitForBodyText("Snapshot Comparison");
  await waitForBodyText("Net worth delta");
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
  if (!exported.settings?.planning?.scenario || !exported.settings?.planning?.drawdown) {
    throw new Error("Exported JSON did not include planning assumptions");
  }
  await jsClick("//button[contains(., 'Reset')]");
  await waitForBodyText("Portfolio reset locally");
  await navClick("Backup");
  const restoreInput = await driver.wait(until.elementLocated(By.xpath("//input[@type='file' and contains(@accept, 'application/json')]")), 15000);
  await restoreInput.sendKeys(backupDownloadPath);
  await waitForBodyText("Restored 5 balance record(s) from backup");
  await navClick("Goals");
  await driver.wait(async () => {
    const body = (await driver.findElement(By.css("body")).getText()).toLowerCase();
    return body.includes("retirement") && body.includes("needed today") && body.includes("combined goals") && body.includes("map assets to goals");
  }, 15000);
  await navClick("Overview");
  await waitForBodyText("Analytics scope");
  await jsClick("//button[.//strong[normalize-space(.)='Combined Goals']]");
  await waitForBodyText("Combined goal analytics");
  await navClick("Snapshots");
  await driver.wait(async () => {
    const body = (await driver.findElement(By.css("body")).getText()).toLowerCase();
    return body.includes("snapshot library") && body.includes("no market fetch") && body.includes("snapshot history");
  }, 15000);
  await waitForBodyText("Frozen snapshot history uses only saved snapshot analytics", 20000);
  await assertNoStackedAreaTimeline("restored snapshot frozen timelines");
  await assertVisibleNativeLineCharts("restored snapshot frozen timelines", 4);
  await assertNativeLineTooltip("restored snapshot frozen timeline tooltip");

  await driver.executeScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.__portfolioTrackerMarketCalls = 0;
    window.__portfolioTrackerMarketPrice = 30;
    window.__portfolioTrackerMarketDate = "2026-06-24";
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input?.url ?? "";
      if (url.includes("/api/market-data")) {
        window.__portfolioTrackerMarketCalls += 1;
        const payload = {
          navs: [],
          stocks: [{ symbol: "TST", price: window.__portfolioTrackerMarketPrice, currency: "USD", asOfDate: window.__portfolioTrackerMarketDate, source: "selenium_quote" }],
          fx: { pair: "USDINR", from: "USD", to: "INR", rate: 96, asOfDate: window.__portfolioTrackerMarketDate, source: "selenium_fx" },
          fxs: [],
          errors: []
        };
        return Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      return originalFetch(input, init);
    };
  });

  const fidelityCsvPath = path.resolve("test-results/manual-fidelity-smoke.csv");
  fs.writeFileSync(fidelityCsvPath, [
    "transaction_id,date,platform,asset_type,symbol_or_isin,name,type,quantity,price ($),USD-INR,fees,taxes,currency,category,notes",
    "1,15-02-2025,Fidelity,us_stock,TST,Example US Stock,buy,10,10,80,0,,USD,Equity,RSU1",
    "2,15-05-2025,Fidelity,us_stock,TST,Example US Stock,buy,5,12,81,0,,USD,Equity,RSU2",
    "3,28-05-2026,Fidelity,us_stock,TST,Example US Stock,sell,3,30,90,0,,USD,Equity,RSU1"
  ].join("\n"));
  await jsClick("//button[contains(., 'Reset')]");
  await waitForBodyText("Portfolio reset locally");
  await navClick("Imports");
  const fidelityFileInput = await driver.wait(until.elementLocated(By.xpath("(//input[@type='file'])[1]")), 15000);
  await fidelityFileInput.sendKeys(fidelityCsvPath);
  await waitForBodyText("parse the manual CSV");
  await jsClick("//button[normalize-space(.)='Parse Manual CSV']");
  await waitForBodyText("Manual CSV committed: 1 holding(s), 3 transaction(s)", 30000);
  await navClick("Holdings");
  await driver.wait(async () => {
    const body = await driver.findElement(By.css("body")).getText();
    return body.includes("Example US Stock") && body.includes("Direct Stock") && body.toLowerCase().includes("price") && body.includes("$30.00") && body.includes("12");
  }, 20000);
  await assertNoFakeChartRows("holding ranking rows");
  await assertNoChartRowOverlap("holding ranking rows");
  await assertVisibleChartBars("holding ranking rows");
  await jsClick("//button[contains(., 'Edit Holdings')]");
  await driver.wait(async () => await driver.executeScript(() => Boolean(document.querySelector(".taper-mode-select"))), 10000);
  await driver.executeScript(() => {
    const select = document.querySelector(".taper-mode-select");
    select.value = "medium";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await waitForBodyText("Medium taper", 15000);
  await jsClick("//button[contains(., 'Done Editing')]");
  await waitForBodyText("Tracked", 15000);
  await navClick("Overview");
  await jsClick("//button[.//strong[normalize-space(.)='Overall']]");
  await jsClick("//button[.//strong[normalize-space(.)='Allocation']]");
  await waitForBodyText("Direct stocks", 15000);
  await assertAssetCommandMetricContrast("direct stock asset class command metrics");
  await assertSubsectionCollapsibleSections("direct stock asset class subsection collapse controls");
  await assertNoFakeChartRows("direct stock asset class ranking rows");
  await assertNoChartRowOverlap("direct stock asset class ranking rows");
  await assertVisibleChartBars("direct stock asset class ranking rows");
  await navClick("Planning");
  await waitForBodyText("Planning Lab", 15000);
  await waitForBodyText("Scenario Planning", 15000);
  await waitForBodyText("Rebalancing View", 15000);
  await waitForBodyText("Goal-level advisory drift", 15000);
  await waitForBodyText("Income Projection", 15000);
  await assertNoPageOverflow("Fidelity planning page");
  await navClick("Tax");
  await waitForBodyText("Realized Lot Audit", 15000);
  await waitForBodyText("Tax Rule Trace", 15000);
  await waitForBodyText("FIFO", 15000);
  await waitForBodyText("Example US Stock", 15000);
  await waitForBodyText("Foreign", 15000);
  await navClick("Data Quality");
  await waitForBodyText("Data Reconciliation", 15000);
  await waitForBodyText("Market Data Health", 15000);
  await navClick("Settings");
  await waitForBodyText("Portfolio tax estimate", 15000);
  await waitForBodyText("Show USD equivalents", 15000);
  await waitForBodyText("Planning Assumptions", 15000);
  const usdToggle = await driver.wait(until.elementLocated(By.xpath("//label[contains(., 'Show USD equivalents')]//input[@type='checkbox']")), 15000);
  await driver.executeScript("arguments[0].scrollIntoView({block: 'center'});", usdToggle);
  await usdToggle.click();
  await driver.wait(async () => await driver.executeScript(() => document.querySelector("label.toggle-row input[type='checkbox']")?.checked === true), 10000);
  await navClick("Holdings");
  await driver.wait(async () => {
    const body = await driver.findElement(By.css("body")).getText();
    return body.includes("Example US Stock") && body.includes("~$");
  }, 15000);

  fs.rmSync(backupDownloadPath, { force: true });
  await jsClick("//button[contains(., 'Export')]");
  await waitForFile(backupDownloadPath, 20000);
  const exportedFidelity = JSON.parse(fs.readFileSync(backupDownloadPath, "utf8"));
  if (!exportedFidelity.manualBalances.some((balance) => balance.taperMode === "medium")) {
    throw new Error("Exported Fidelity JSON did not preserve the selected holding taper mode");
  }
  if (exportedFidelity.settings?.displayCurrency?.showUsdEquivalent !== true) {
    throw new Error("Exported Fidelity JSON did not preserve the USD equivalent display setting");
  }
  await driver.executeScript(() => {
    window.__portfolioTrackerMarketCalls = 0;
    window.__portfolioTrackerMarketPrice = 44;
    window.__portfolioTrackerMarketDate = "2026-06-24";
  });
  await jsClick("//button[contains(., 'Reset')]");
  await waitForBodyText("Portfolio reset locally");
  await navClick("Backup");
  const restoredFidelityInput = await driver.wait(until.elementLocated(By.xpath("//input[@type='file' and contains(@accept, 'application/json')]")), 15000);
  await restoredFidelityInput.sendKeys(backupDownloadPath);
  await waitForBodyText("Restored 1 balance record(s) from backup exactly as exported", 20000);
  await driver.wait(async () => await driver.executeScript(() => window.__portfolioTrackerMarketCalls === 0), 10000);
  await navClick("Holdings");
  await driver.wait(async () => {
    const body = await driver.findElement(By.css("body")).getText();
    return body.includes("Example US Stock") && body.includes("$30.00") && body.includes("$360.00") && body.includes("~$");
  }, 15000);
  await jsClick("//button[contains(., 'Refresh')]");
  await waitForBodyText("holding valuation(s) updated", 20000);
  await driver.wait(async () => await driver.executeScript(() => window.__portfolioTrackerMarketCalls >= 1), 10000);
  await navClick("Holdings");
  await driver.wait(async () => {
    const body = await driver.findElement(By.css("body")).getText();
    return body.includes("Example US Stock") && body.includes("$44.00") && body.includes("$528.00") && body.includes("~$");
  }, 15000);
  await assertResponsiveCorePages();
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
