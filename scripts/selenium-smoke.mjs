import fs from "node:fs";
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
  await jsClick("//button[contains(., 'Holdings')]");
  await waitForBodyText("XIRR Coverage");
  await driver.wait(async () => {
    const body = (await driver.findElement(By.css("body")).getText()).toLowerCase();
    return body.includes("xirr coverage") && body.includes("top holding xirr") && body.includes("sort by xirr");
  }, 15000);
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
