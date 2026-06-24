import fs from "node:fs";
import path from "node:path";
import { Builder, Browser, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";

const url = process.env.APP_URL ?? "http://127.0.0.1:3000";
const firefoxBinary = process.env.FIREFOX_BIN ?? "/arm/tools/mozilla/firefox/146.0.1/linux64/firefox/firefox";
const geckoDriver = process.env.GECKODRIVER_BIN ?? "/arm/tools/mozilla/geckodriver/0.35.0/linux64/geckodriver";
const screenshotPath = process.env.SCREENSHOT_PATH ?? "test-results/selenium-dashboard.png";

fs.mkdirSync("test-results", { recursive: true });

const options = new firefox.Options()
  .setBinary(firefoxBinary)
  .addArguments("-headless");
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

try {
  await driver.get(url);
  await driver.wait(until.elementLocated(By.css("h1")), 15000);
  const title = await driver.findElement(By.css("h1")).getText();
  if (!/Portfolio Analytics|Holdings|Transactions|Add Entry|Imports|Backup/.test(title)) {
    throw new Error(`Unexpected page heading: ${title}`);
  }
  for (const label of ["Overview", "Allocation", "Holdings", "History"]) {
    await jsClick(`//button[.//strong[normalize-space(.)='${label}']]`);
    await driver.wait(async () => {
      const body = (await driver.findElement(By.css("body")).getText()).toLowerCase();
      if (label === "Overview") return body.includes("current allocation explorer");
      if (label === "Allocation") return body.includes("allocation map") && body.includes("by asset type");
      if (label === "Holdings") return body.includes("top 5 concentration") && body.includes("asset modules");
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
    return body.includes("Example US Stock") && body.includes("Direct Stock") && body.includes("12");
  }, 20000);
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
