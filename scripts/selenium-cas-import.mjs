import fs from "node:fs";
import { Builder, Browser, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";

const url = process.env.APP_URL ?? "http://127.0.0.1:3000";
const pdfPath = process.env.CAS_PDF;
const password = process.env.CAS_PASSWORD;
const firefoxBinary = process.env.FIREFOX_BIN ?? "/arm/tools/mozilla/firefox/146.0.1/linux64/firefox/firefox";
const geckoDriver = process.env.GECKODRIVER_BIN ?? "/arm/tools/mozilla/geckodriver/0.35.0/linux64/geckodriver";
const screenshotPath = process.env.SCREENSHOT_PATH ?? "test-results/selenium-cas-import.png";

if (!password) throw new Error("CAS_PASSWORD is required");
if (!pdfPath) throw new Error("CAS_PDF is required");
if (!fs.existsSync(pdfPath)) throw new Error(`CAS PDF not found: ${pdfPath}`);
fs.mkdirSync("test-results", { recursive: true });

const options = new firefox.Options().setBinary(firefoxBinary).addArguments("-headless");
const service = new firefox.ServiceBuilder(geckoDriver);
const driver = await new Builder()
  .forBrowser(Browser.FIREFOX)
  .setFirefoxOptions(options)
  .setFirefoxService(service)
  .build();

let failure;
try {
  await driver.get(url);
  await driver.wait(until.elementLocated(By.xpath("//button[contains(., 'Imports')]")), 20000).click();
  await driver.wait(until.elementLocated(By.css('input[type="file"]')), 20000).sendKeys(pdfPath);
  await driver.wait(until.elementLocated(By.css('input[type="password"]')), 20000).sendKeys(password);
  await driver.findElement(By.xpath("//button[contains(., 'Parse CAS PDF')]")).click();

  await driver.wait(async () => {
    const body = await driver.findElement(By.css("body")).getText();
    return body.includes("CAS staged:") || body.includes("CAS PDF import failed") || body.includes("error(s)");
  }, 60000);

  const bodyAfterParse = await driver.findElement(By.css("body")).getText();
  if (!bodyAfterParse.includes("CAS staged:")) {
    throw new Error(`CAS parse did not stage successfully. Body excerpt: ${bodyAfterParse.slice(0, 1000)}`);
  }

  await driver.findElement(By.xpath("//button[contains(., 'Commit CAS Import')]")).click();
  await driver.wait(async () => (await driver.findElement(By.css("body")).getText()).includes("CAS committed:"), 20000);
  fs.writeFileSync(screenshotPath, await driver.takeScreenshot(), "base64");
  console.log("Selenium CAS import smoke passed");
  console.log(`Screenshot: ${screenshotPath}`);
} catch (error) {
  failure = error;
} finally {
  await Promise.race([driver.quit(), new Promise((resolve) => setTimeout(resolve, 3000))]);
}

if (failure) {
  throw failure;
}
process.exit(0);
