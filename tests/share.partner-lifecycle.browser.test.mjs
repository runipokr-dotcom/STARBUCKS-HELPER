import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CAPABILITY = "S".repeat(43);
const originalHtml = await readFile(new URL("../share.html", import.meta.url), "utf8");
let fixtureRoot;

function replaceFunction(source, name, replacement) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(0, start) + replacement + source.slice(index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

function syntheticAdapter(mode) {
  const expiresIn = mode === "expiry" ? 450 : 60_000;
  return `<script>
    window.__synthetic = { mode: ${JSON.stringify(mode)}, unsubscribed: 0, terminated: 0 };
    window.__syntheticExpiresAt = Date.now() + ${expiresIn};
    window.__syntheticFirestore = {
      doc() { return {}; },
      setDoc() { return Promise.reject(new Error("synthetic write blocked")); },
      terminate() { window.__synthetic.terminated += 1; return Promise.resolve(); },
      onSnapshot(_ref, next, error) {
        window.__synthetic.snapshotError = error;
        setTimeout(() => next({
          exists: () => true,
          data: () => ({
            active: true,
            categories: ["합성 분류"],
            expiresAt: { toMillis: () => window.__syntheticExpiresAt },
            notice: "합성 전용 페이지",
            products: [{
              id: 1,
              name: "합성 상품",
              sale: 1100,
              offer: 900,
              category: "합성 분류",
              tags: ["합성"],
              images: [],
              updatedAt: 1
            }]
          })
        }), 0);
        if (${JSON.stringify(mode)} === "revoke")
          setTimeout(() => error(new Error("synthetic permission denied")), 450);
        return () => { window.__synthetic.unsubscribed += 1; };
      }
    };
  </script>`;
}

function resultProbe() {
  return `<script>
    setTimeout(() => {
      const pick = document.querySelector(".pick");
      if (pick) pick.click();
      document.querySelector("#customerName").value = "합성 고객";
      window.__synthetic.initial = {
        productVisible: document.querySelector("#grid").textContent.includes("합성 상품"),
        offerVisible: document.querySelector("#grid").textContent.includes("제안가"),
        basketVisible: document.querySelector("#basket").hidden === false,
        quoteUsesOffer: document.querySelector("#grand").textContent === "900원",
        gridColumns: getComputedStyle(document.querySelector("#grid"))
          .gridTemplateColumns.split(" ").filter(Boolean).length
      };
    }, 150);
    setTimeout(() => {
      const result = {
        mode: window.__synthetic.mode,
        initial: window.__synthetic.initial,
        final: {
          productCleared: document.querySelector("#grid").textContent.trim() === "",
          quoteCleared: document.querySelector("#grand").textContent === "",
          basketHidden: document.querySelector("#basket").hidden === true,
          offerDisabled: document.querySelector("#includeOffer").checked === false,
          offerToggleHidden: document.querySelector("#offerToggleWrap").hidden === true,
          customerCleared: document.querySelector("#customerName").value === "",
          detailClosed: document.querySelector("#productDetailDialog").open === false,
          notFoundVisible: document.querySelector("#notFound").hidden === false,
          hashCleared: location.hash === "",
          unsubscribed: window.__synthetic.unsubscribed,
          terminated: window.__synthetic.terminated
        }
      };
      document.body.innerHTML = '<pre id="synthetic-result"></pre>';
      document.querySelector("#synthetic-result").textContent = JSON.stringify(result);
    }, 950);
  </script>`;
}

async function createFixture(mode) {
  let html = replaceFunction(
    originalHtml,
    "initShareSync",
    `async function initShareSync() {
      shareState = { db: {}, firestore: window.__syntheticFirestore, ready: true };
      return shareState;
    }`,
  );
  html = html.replace("<script>\n      const FIREBASE_CONFIG", `${syntheticAdapter(mode)}\n    <script>\n      const FIREBASE_CONFIG`);
  html = html.replace("</body>", `${resultProbe()}\n  </body>`);
  const directory = join(fixtureRoot, mode);
  await mkdir(directory, { recursive: true });
  const path = join(directory, "partner.html");
  await writeFile(path, html, "utf8");
  return path;
}

function runChrome(path, mode) {
  const profile = join(fixtureRoot, `profile-${mode}`);
  const result = spawnSync(CHROME, [
    "--headless=new",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-gpu",
    "--disable-sync",
    "--no-default-browser-check",
    "--no-first-run",
    `--window-size=${mode === "expiry" ? "390,844" : "1280,900"}`,
    `--user-data-dir=${profile}`,
    "--virtual-time-budget=1400",
    "--dump-dom",
    `${pathToFileURL(path).href}#${CAPABILITY}`,
  ], { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  const match = result.stdout.match(/<pre id="synthetic-result">([^<]+)<\/pre>/);
  assert.ok(match, `missing synthetic result for ${mode}\n${result.stdout.slice(-1000)}`);
  return JSON.parse(match[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
}

before(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "starbucks-helper-partner-ui-"));
});

after(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
});

for (const mode of ["expiry", "revoke"]) {
  test(`open partner page clears rendered quote state after synthetic ${mode}`, async () => {
    const path = await createFixture(mode);
    const result = runChrome(path, mode);
    assert.deepEqual(result.initial, {
      productVisible: true,
      offerVisible: true,
      basketVisible: true,
      quoteUsesOffer: true,
      gridColumns: mode === "expiry" ? 2 : 5,
    });
    assert.equal(result.final.productCleared, true);
    assert.equal(result.final.quoteCleared, true);
    assert.equal(result.final.basketHidden, true);
    assert.equal(result.final.offerDisabled, true);
    assert.equal(result.final.offerToggleHidden, true);
    assert.equal(result.final.customerCleared, true);
    assert.equal(result.final.detailClosed, true);
    assert.equal(result.final.notFoundVisible, true);
    assert.equal(result.final.hashCleared, true);
    assert.ok(result.final.unsubscribed >= 1);
    assert.equal(result.final.terminated, 1);
  });
}
