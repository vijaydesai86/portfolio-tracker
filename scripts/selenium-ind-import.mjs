import fs from "node:fs";
import { Builder, Browser, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";

const url = process.env.APP_URL ?? "http://127.0.0.1:3000";
const xlsxPath = process.env.IND_XLSX_PATH;
const firefoxBinary = process.env.FIREFOX_BIN ?? "/arm/tools/mozilla/firefox/146.0.1/linux64/firefox/firefox";
const geckoDriver = process.env.GECKODRIVER_BIN ?? "/arm/tools/mozilla/geckodriver/0.35.0/linux64/geckodriver";
const screenshotPath = process.env.SCREENSHOT_PATH ?? "test-results/selenium-ind-import.png";

if (!xlsxPath) throw new Error("IND_XLSX_PATH is required");
if (!fs.existsSync(xlsxPath)) throw new Error(`INDMoney XLSX not found: ${xlsxPath}`);
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
  await driver.wait(until.elementLocated(By.css('input[type="file"]')), 20000).sendKeys(xlsxPath);
  await driver.wait(until.elementLocated(By.xpath("//button[contains(., 'Parse INDMoney XLSX')]")), 20000).click();

  await driver.wait(async () => {
    const body = await driver.findElement(By.css("body")).getText();
    return body.includes("INDMoney staged:") || body.includes("INDMoney XLSX import failed") || body.includes("error(s)");
  }, 60000);

  const bodyAfterParse = await driver.findElement(By.css("body")).getText();
  if (!bodyAfterParse.includes("INDMoney staged:")) {
    throw new Error(`INDMoney parse did not stage successfully. Body excerpt: ${bodyAfterParse.slice(0, 1000)}`);
  }

  await driver.findElement(By.xpath("//button[contains(., 'Commit INDMoney Import')]")).click();
  await driver.wait(async () => (await driver.findElement(By.css("body")).getText()).includes("INDMoney committed:"), 20000);
  fs.writeFileSync(screenshotPath, await driver.takeScreenshot(), "base64");
  console.log("Selenium INDMoney import smoke passed");
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
