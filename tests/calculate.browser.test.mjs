import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const source = readFileSync(new URL("../calculate.html", import.meta.url), "utf8");
const artifactRoot = await mkdtemp(join(tmpdir(), "starbucks-calculate-browser-"));

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForFile(path, chrome, stderr) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(path)) return;
    if (chrome.exitCode !== null) throw new Error(`Chrome exited early: ${stderr.join("")}`);
    await delay(50);
  }
  throw new Error(`Chrome DevTools endpoint did not start: ${stderr.join("")}`);
}

class DevToolsClient {
  constructor(webSocketUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
    this.socket = new WebSocket(webSocketUrl);
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      const listeners = this.events.get(message.method) || [];
      this.events.delete(message.method);
      listeners.forEach((resolve) => resolve(message.params));
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  waitFor(method) {
    return new Promise((resolve) => {
      const listeners = this.events.get(method) || [];
      listeners.push(resolve);
      this.events.set(method, listeners);
    });
  }

  close() {
    this.socket.close();
  }
}

async function createFixture() {
  const fixture = source.replace(/<script src="auth-gate\.js\?v=[^"]+"><\/script>/, "");
  const path = join(artifactRoot, "calculate.html");
  await writeFile(path, fixture, "utf8");
  return path;
}

async function runChrome(path, name, width, height, mobile) {
  const profile = join(artifactRoot, `profile-${name}`);
  const screenshot = join(artifactRoot, `${name}.png`);
  await mkdir(profile, { recursive: true });
  const stderr = [];
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-gpu",
    "--disable-sync",
    "--hide-scrollbars",
    "--no-default-browser-check",
    "--no-first-run",
    "--remote-allow-origins=*",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  chrome.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

  let client;
  try {
    const endpointFile = join(profile, "DevToolsActivePort");
    await waitForFile(endpointFile, chrome, stderr);
    const [port] = (await readFile(endpointFile, "utf8")).trim().split("\n");
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
    const target = targets.find((candidate) => candidate.type === "page");
    assert.ok(target, "Chrome page target should exist");

    client = new DevToolsClient(target.webSocketDebuggerUrl);
    await client.open();
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
      screenWidth: width,
      screenHeight: height
    });

    const loaded = client.waitFor("Page.loadEventFired");
    await client.send("Page.navigate", { url: pathToFileURL(path).href });
    await loaded;

    const evaluated = await client.send("Runtime.evaluate", {
      expression: `(() => {
        document.querySelector("#listPrice").value = "34000";
        document.querySelector("#quantity").value = "2";
        document.querySelector("#salePrice").value = "35400";
        document.querySelector("#purchaseType").value = "C";
        document.querySelector("#channel").value = "coupang";
        document.querySelector("#shippingIncome").value = "0";
        document.querySelector("#couponEnabled").checked = false;
        update();
        return {
          viewportWidth: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          totalSale: document.querySelector("#totalSalePriceCell").textContent,
          settlement: document.querySelector("#settlementCell").textContent,
          profit: document.querySelector("#profitCell").textContent,
          roi: document.querySelector("#roiCell").textContent,
          structure: document.querySelector("#priceStructureText").textContent,
          labels: [...document.querySelectorAll("#calcForm label")].map((node) => node.childNodes[0].textContent.trim()),
          saleTableColumns: document.querySelector("#totalSalePriceCell").closest("tr").children.length,
          layoutColumns: getComputedStyle(document.querySelector(".layout")).gridTemplateColumns.split(" ").filter(Boolean).length,
          tableScrollContainers: document.querySelectorAll(".table-scroll").length
        };
      })()`,
      returnByValue: true
    });
    assert.equal(evaluated.exceptionDetails, undefined, "calculator evaluation should not throw");

    const captured = await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      fromSurface: true
    });
    await writeFile(screenshot, Buffer.from(captured.data, "base64"));
    return { data: evaluated.result.value, screenshot };
  } finally {
    if (client) client.close();
    chrome.kill("SIGTERM");
  }
}

test("real Chrome renders the quantity-two calculation on PC and mobile", async (context) => {
  assert.equal(existsSync(CHROME), true, "Google Chrome must be installed");
  const fixture = await createFixture();

  for (const viewport of [
    { name: "pc", width: 1280, height: 1000, mobile: false, columns: 2 },
    { name: "mobile", width: 390, height: 844, mobile: true, columns: 1 }
  ]) {
    await context.test(viewport.name, async () => {
      const rendered = await runChrome(
        fixture,
        viewport.name,
        viewport.width,
        viewport.height,
        viewport.mobile
      );
      console.log(`${viewport.name} calculate render: ${JSON.stringify(rendered.data)}`);
      assert.equal(rendered.data.viewportWidth, viewport.width);
      assert.ok(rendered.data.documentWidth <= rendered.data.viewportWidth, "page should not overflow horizontally");
      assert.equal(rendered.data.totalSale, "70,800원");
      assert.equal(rendered.data.settlement, "62,304원");
      assert.equal(rendered.data.profit, "5,490원");
      assert.equal(rendered.data.roi, "9.66%");
      assert.match(rendered.data.structure, /정가 총액 68,000원/);
      assert.match(rendered.data.structure, /총판매액 70,800원/);
      assert.equal(rendered.data.saleTableColumns, 5);
      assert.equal(rendered.data.layoutColumns, viewport.columns);
      assert.equal(rendered.data.tableScrollContainers, 3);
      assert.ok(rendered.data.labels.includes("정가 (개당)"));
      assert.ok(rendered.data.labels.includes("현재 판매가 검산 (개당)"));
      assert.ok(rendered.data.labels.includes("고객 배송료 (주문당 1회)"));
      assert.equal(existsSync(rendered.screenshot), true);
    });
  }

  console.log(`calculate browser artifacts: ${artifactRoot}`);
});
