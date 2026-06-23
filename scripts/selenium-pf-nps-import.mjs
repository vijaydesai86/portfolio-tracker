import fs from "node:fs";
import { Builder, Browser, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";

const url = process.env.APP_URL ?? "http://127.0.0.1:3000";
const pfPdfPaths = splitPaths(process.env.PF_PDF_PATHS ?? process.env.PF_PDF_PATH);
const npsCsvPaths = splitPaths(process.env.NPS_CSV_PATHS ?? process.env.NPS_CSV_PATH);
const firefoxBinary = process.env.FIREFOX_BIN ?? "/arm/tools/mozilla/firefox/146.0.1/linux64/firefox/firefox";
const geckoDriver = process.env.GECKODRIVER_BIN ?? "/arm/tools/mozilla/geckodriver/0.35.0/linux64/geckodriver";
const screenshotPath = process.env.SCREENSHOT_PATH ?? "test-results/selenium-pf-nps-import.png";

if (pfPdfPaths.length === 0) throw new Error("PF_PDF_PATH or PF_PDF_PATHS is required");
if (npsCsvPaths.length === 0) throw new Error("NPS_CSV_PATH or NPS_CSV_PATHS is required");
for (const pfPdfPath of pfPdfPaths) if (!fs.existsSync(pfPdfPath)) throw new Error(`PF PDF not found: ${pfPdfPath}`);
for (const npsCsvPath of npsCsvPaths) if (!fs.existsSync(npsCsvPath)) throw new Error(`NPS CSV not found: ${npsCsvPath}`);
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

  await driver.wait(until.elementLocated(By.css('input[type="file"]')), 20000).sendKeys(pfPdfPaths.join("\n"));
  await driver.wait(until.elementLocated(By.xpath("//button[contains(., 'Parse PF PDF')]")), 20000).click();
  await driver.wait(async () => {
    const body = await driver.findElement(By.css("body")).getText();
    return body.includes("PF staged:") || body.includes("PF PDF import failed") || body.includes("PF parsed with");
  }, 60000);
  const pfBody = await driver.findElement(By.css("body")).getText();
  if (!pfBody.includes("PF staged:")) throw new Error(`PF parse did not stage successfully. Body excerpt: ${pfBody.slice(0, 1000)}`);
  await driver.findElement(By.xpath("//button[contains(., 'Commit PF Import')]")).click();
  await driver.wait(async () => (await driver.findElement(By.css("body")).getText()).includes("PF committed:"), 20000);

  const fileInput = await driver.findElement(By.css('input[type="file"]'));
  await driver.executeScript("arguments[0].value = null", fileInput);
  await fileInput.sendKeys(npsCsvPaths.join("\n"));
  await driver.wait(until.elementLocated(By.xpath("//button[contains(., 'Parse NPS CSV')]")), 20000).click();
  await driver.wait(async () => {
    const body = await driver.findElement(By.css("body")).getText();
    return body.includes("NPS staged:") || body.includes("NPS CSV import failed") || body.includes("NPS parsed with");
  }, 60000);
  const npsBody = await driver.findElement(By.css("body")).getText();
  if (!npsBody.includes("NPS staged:")) throw new Error(`NPS parse did not stage successfully. Body excerpt: ${npsBody.slice(0, 1000)}`);
  await driver.findElement(By.xpath("//button[contains(., 'Commit NPS Import')]")).click();
  await driver.wait(async () => (await driver.findElement(By.css("body")).getText()).includes("NPS committed:"), 20000);

  fs.writeFileSync(screenshotPath, await driver.takeScreenshot(), "base64");
  console.log("Selenium PF/NPS import smoke passed");
  console.log(`Screenshot: ${screenshotPath}`);
} catch (error) {
  failure = error;
} finally {
  await Promise.race([driver.quit(), new Promise((resolve) => setTimeout(resolve, 3000))]);
}

if (failure) throw failure;
process.exit(0);

function splitPaths(value) {
  return String(value ?? "")
    .split(process.platform === "win32" ? ";" : ":")
    .map((item) => item.trim())
    .filter(Boolean);
}
