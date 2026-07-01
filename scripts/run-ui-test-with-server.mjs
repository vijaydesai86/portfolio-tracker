import { spawn } from "node:child_process";

const port = Number(process.env.PORT || 3000);
const appUrl = process.env.APP_URL || `http://127.0.0.1:${port}`;
const server = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["start"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"]
});

let output = "";
server.stdout.on("data", (chunk) => { output += chunk.toString(); process.stdout.write(chunk); });
server.stderr.on("data", (chunk) => { output += chunk.toString(); process.stderr.write(chunk); });

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer() {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("Next server exited before becoming ready.\n" + output);
    try {
      const response = await fetch(appUrl, { cache: "no-store" });
      if (response.ok || response.status < 500) return;
    } catch {
      // Retry until Next has bound the port.
    }
    await wait(1000);
  }
  throw new Error("Timed out waiting for Next server at " + appUrl);
}

function runSmoke() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/selenium-smoke.mjs"], {
      env: { ...process.env, APP_URL: appUrl },
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("Selenium smoke failed with exit code " + code));
    });
  });
}

try {
  await waitForServer();
  await runSmoke();
} finally {
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await wait(1000);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
}
