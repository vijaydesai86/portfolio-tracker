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

try {
  await driver.get(url);
  await driver.wait(until.elementLocated(By.css("h1")), 15000);
  const title = await driver.findElement(By.css("h1")).getText();
  if (!/Portfolio Analytics|Holdings|Transactions|Imports|Backup/.test(title)) {
    throw new Error(`Unexpected page heading: ${title}`);
  }
  for (const label of ["Overview", "Allocation", "Growth", "Risk"]) {
    const tab = await driver.wait(until.elementLocated(By.xpath(`//button[.//strong[normalize-space(.)='${label}']]`)), 15000);
    await tab.click();
    await driver.wait(async () => {
      const body = await driver.findElement(By.css("body")).getText();
      if (label === "Overview") return body.includes("Portfolio Growth");
      if (label === "Allocation") return body.includes("Asset Class Growth");
      if (label === "Growth") return body.includes("Asset Type Growth");
      return body.includes("Top 5 Concentration");
    }, 15000);
  }
  fs.writeFileSync(screenshotPath, await driver.takeScreenshot(), "base64");
  console.log(`Selenium smoke passed: ${title}`);
  console.log(`Screenshot: ${screenshotPath}`);
} finally {
  await Promise.race([
    driver.quit(),
    new Promise((resolve) => setTimeout(resolve, 3000))
  ]);
  process.exit(0);
}
