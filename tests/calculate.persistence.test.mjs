import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = readFileSync(new URL("../calculate.html", import.meta.url), "utf8");
const inlineScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .find((source) => source.includes("const SETTINGS_KEY"));

assert.ok(inlineScript, "calculate.html persistence script should exist");

const storageKey = "starbucks-helper-calculator-settings-v1";
const defaults = {
  listPrice: "20000",
  saleUnitMode: "single",
  quantity: "1",
  setSize: "3",
  purchaseType: "C",
  channel: "coupang",
  rateA: "88",
  rateB: "90",
  rateC: "88",
  rateD: "88",
  rateAuction: "85",
  rateNaverBuy: "88",
  targetRoi: "11",
  shippingIncome: "0",
  salePrice: "21100",
  couponAmount: "3750",
  couponEnabled: false
};

function createHarness({ stored = null, failRead = false, failWrite = false } = {}) {
  const elements = new Map();
  const timers = new Map();
  const windowListeners = new Map();
  const storage = new Map();
  const calls = { get: 0, set: 0, remove: 0 };
  let nextTimer = 1;
  if (stored !== null) storage.set(storageKey, stored);

  function getElement(id) {
    if (!elements.has(id)) {
      const raw = defaults[id];
      const listeners = new Map();
      elements.set(id, {
        value: typeof raw === "boolean" ? "" : String(raw ?? ""),
        checked: typeof raw === "boolean" ? raw : false,
        textContent: "",
        innerHTML: "",
        className: "",
        parentElement: { className: "" },
        listeners,
        addEventListener(type, listener) {
          const current = listeners.get(type) || [];
          current.push(listener);
          listeners.set(type, current);
        }
      });
    }
    return elements.get(id);
  }

  const localStorage = {
    getItem(key) {
      calls.get += 1;
      if (failRead) throw new Error("read blocked");
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      calls.set += 1;
      if (failWrite) throw new Error("write blocked");
      storage.set(key, String(value));
    },
    removeItem(key) {
      calls.remove += 1;
      storage.delete(key);
    }
  };

  const context = vm.createContext({
    console,
    localStorage,
    setTimeout(callback) {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    window: {
      addEventListener(type, listener) {
        const current = windowListeners.get(type) || [];
        current.push(listener);
        windowListeners.set(type, current);
      }
    },
    document: {
      getElementById: getElement,
      querySelectorAll() {
        return Object.keys(defaults).map(getElement);
      }
    }
  });

  vm.runInContext(inlineScript, context, { filename: "calculate.html" });

  return {
    calls,
    context,
    storage,
    element: getElement,
    dispatch(id, type) {
      for (const listener of getElement(id).listeners.get(type) || []) listener({ type });
    },
    dispatchWindow(type) {
      for (const listener of windowListeners.get(type) || []) listener({ type });
    },
    runTimers() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((callback) => callback());
    },
    timerCount() {
      return timers.size;
    }
  };
}

function saved(values) {
  return JSON.stringify({ version: 1, values });
}

test("valid versioned settings restore every calculator input before the first result", () => {
  const values = {
    listPrice: "32000",
    saleUnitMode: "set",
    quantity: "2",
    setSize: "3",
    purchaseType: "C",
    channel: "naver",
    rateA: "87.5",
    rateB: "89",
    rateC: "84",
    rateD: "86",
    rateAuction: "83",
    rateNaverBuy: "81",
    targetRoi: "15",
    shippingIncome: "3000",
    salePrice: "35000",
    couponAmount: "3750",
    couponEnabled: true
  };
  const app = createHarness({ stored: saved(values) });

  for (const [id, value] of Object.entries(values)) {
    if (typeof value === "boolean") assert.equal(app.element(id).checked, value, id);
    else assert.equal(app.element(id).value, value, id);
  }
  assert.equal(app.element("costMetric").textContent, "130,236원");
  assert.equal(app.element("unitSummary").textContent, "3개 들이 × 2세트 · 총 구성 수량 6개");
  assert.equal(app.element("settingsStatus").textContent, "마지막 입력값을 불러왔습니다.");
});

test("legacy saved values without unit fields retain the original single-item meaning", () => {
  const app = createHarness({
    stored: saved({
      listPrice: "32000",
      quantity: "2",
      purchaseType: "C",
      rateC: "84",
      couponAmount: "3750",
      couponEnabled: true
    })
  });

  assert.equal(app.element("saleUnitMode").value, "single");
  assert.equal(app.element("setSize").value, "3");
  assert.equal(app.element("costMetric").textContent, "43,412원");
  assert.equal(app.element("unitSummary").textContent, "낱개 2개 판매 · 총 구성 수량 2개");
});

test("input and change events debounce one versioned save with only approved fields", () => {
  const app = createHarness();
  app.element("listPrice").value = "34000";
  app.dispatch("listPrice", "input");
  app.element("salePrice").value = "35400";
  app.dispatch("salePrice", "change");

  assert.equal(app.calls.set, 0);
  assert.equal(app.timerCount(), 1);
  app.runTimers();
  assert.equal(app.calls.set, 1);

  const payload = JSON.parse(app.storage.get(storageKey));
  assert.equal(payload.version, 1);
  assert.equal(payload.values.listPrice, "34000");
  assert.equal(payload.values.salePrice, "35400");
  assert.equal(payload.values.saleUnitMode, "single");
  assert.equal(payload.values.setSize, "3");
  assert.equal(payload.values.couponAmount, "3750");
  assert.deepEqual(Object.keys(payload.values).sort(), Object.keys(defaults).sort());
  assert.equal("pin" in payload.values, false);
  assert.equal("auth" in payload.values, false);
  assert.equal("session" in payload.values, false);
});

test("zero coupon is persisted while negative, NaN, quantity zero, and invalid enums fall back safely", () => {
  const app = createHarness({
    stored: saved({
      listPrice: "-1",
      saleUnitMode: "invalid",
      quantity: "0",
      setSize: "0",
      purchaseType: "invalid",
      channel: "naver",
      rateC: "NaN",
      shippingIncome: "-3000",
      couponAmount: "0",
      couponEnabled: true
    })
  });

  assert.equal(app.element("listPrice").value, defaults.listPrice);
  assert.equal(app.element("saleUnitMode").value, defaults.saleUnitMode);
  assert.equal(app.element("quantity").value, defaults.quantity);
  assert.equal(app.element("setSize").value, defaults.setSize);
  assert.equal(app.element("purchaseType").value, defaults.purchaseType);
  assert.equal(app.element("channel").value, "naver");
  assert.equal(app.element("rateC").value, defaults.rateC);
  assert.equal(app.element("shippingIncome").value, defaults.shippingIncome);
  assert.equal(app.element("couponAmount").value, "0");
  assert.equal(app.element("couponEnabled").checked, true);
  assert.doesNotMatch(app.element("targetRows").innerHTML, /NaN|Infinity/);
});

test("corrupt JSON, unknown schema versions, and storage read/write failures use graceful defaults", () => {
  for (const stored of ["{broken", saved({ listPrice: "32000" }).replace('"version":1', '"version":99')]) {
    const app = createHarness({ stored });
    assert.equal(app.element("listPrice").value, defaults.listPrice);
    assert.doesNotMatch(app.element("targetRows").innerHTML, /NaN|Infinity/);
  }

  const readBlocked = createHarness({ stored: saved({ listPrice: "32000" }), failRead: true });
  assert.equal(readBlocked.element("listPrice").value, defaults.listPrice);
  assert.match(readBlocked.element("settingsStatus").textContent, /기본값/);

  const writeBlocked = createHarness({ failWrite: true });
  writeBlocked.element("listPrice").value = "34000";
  writeBlocked.dispatch("listPrice", "input");
  assert.doesNotThrow(() => writeBlocked.runTimers());
  assert.match(writeBlocked.element("settingsStatus").textContent, /자동 저장할 수 없습니다/);
});

test("explicit reset button restores defaults and persists them without touching authentication", () => {
  const app = createHarness({ stored: saved({ listPrice: "32000", couponAmount: "4200", couponEnabled: true }) });
  app.dispatch("resetSettings", "click");

  for (const [id, value] of Object.entries(defaults)) {
    if (typeof value === "boolean") assert.equal(app.element(id).checked, value, id);
    else assert.equal(app.element(id).value, value, id);
  }
  const payload = JSON.parse(app.storage.get(storageKey));
  assert.deepEqual(payload.values, defaults);
  assert.equal(app.element("settingsStatus").textContent, "기본값으로 초기화했습니다.");
});

test("pagehide flushes the latest valid values without requiring a UI reload", () => {
  const app = createHarness();
  app.element("saleUnitMode").value = "set";
  app.element("setSize").value = "4";
  app.element("couponAmount").value = "4100";
  app.dispatchWindow("pagehide");
  const payload = JSON.parse(app.storage.get(storageKey));
  assert.equal(payload.values.saleUnitMode, "set");
  assert.equal(payload.values.setSize, "4");
  assert.equal(payload.values.couponAmount, "4100");
});
