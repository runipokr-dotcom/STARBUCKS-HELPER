import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = readFileSync(new URL("../calculate.html", import.meta.url), "utf8");
const inlineScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .find((source) => source.includes("function calculateUnitCost"));

assert.ok(inlineScript, "calculate.html inline calculator script should exist");

const defaultInputs = {
  listPrice: "20000",
  quantity: "1",
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
  couponEnabled: false
};

function runCalculator(overrides = {}) {
  const elements = new Map();
  const inputs = { ...defaultInputs, ...overrides };

  function getElement(id) {
    if (!elements.has(id)) {
      const raw = inputs[id];
      elements.set(id, {
        value: typeof raw === "boolean" ? "" : String(raw ?? ""),
        checked: typeof raw === "boolean" ? raw : false,
        textContent: "",
        innerHTML: "",
        className: "",
        parentElement: { className: "" },
        addEventListener() {}
      });
    }
    return elements.get(id);
  }

  const context = vm.createContext({
    console,
    document: {
      getElementById: getElement,
      querySelectorAll() {
        Object.keys(inputs).forEach(getElement);
        return [...elements.values()];
      }
    }
  });

  vm.runInContext(inlineScript, context, { filename: "calculate.html" });
  return {
    text(id) {
      return getElement(id).textContent;
    },
    html(id) {
      return getElement(id).innerHTML;
    }
  };
}

const formatWon = (value) => `${Math.round(value).toLocaleString("ko-KR")}원`;

function expectedUnitCost(type, listPrice, couponEnabled) {
  const coupon = couponEnabled ? 3750 : 0;
  const variable = listPrice / 10000 * 445;
  const costs = {
    A: listPrice * 0.88 - coupon - variable,
    B: listPrice * 0.9 - coupon,
    C: listPrice * 0.88 - coupon - variable,
    D: listPrice * 0.88 - variable,
    auction: listPrice * 0.85 - coupon,
    naverBuy: listPrice * 0.88 - coupon
  };

  return {
    cost: costs[type],
    orderShippingCredit: type === "A" || type === "D" ? 3000 : 0
  };
}

test("quantity 1 keeps the existing C-type Coupang result", () => {
  const view = runCalculator();

  assert.equal(view.text("costCell"), "16,710원");
  assert.equal(view.text("totalSalePriceCell"), "21,100원");
  assert.equal(view.text("settlementCell"), "18,568원");
  assert.equal(view.text("profitCell"), "1,858원");
  assert.equal(view.text("roiCell"), "11.12%");
});

test("user example applies quantity 2 to the per-item sale price", () => {
  const view = runCalculator({
    listPrice: "34000",
    quantity: "2",
    salePrice: "35400"
  });

  assert.equal(view.text("formulaCell"), "(34,000원 × 88.00% - 0원(쿠폰) - 1,513원(변동비)) × 2개");
  assert.equal(view.text("costCell"), "56,814원");
  assert.equal(view.text("salePriceCell"), "35,400원");
  assert.equal(view.text("totalSalePriceCell"), "70,800원");
  assert.equal(view.text("settlementCell"), "62,304원");
  assert.equal(view.text("profitCell"), "5,490원");
  assert.equal(view.text("roiCell"), "9.66%");
  assert.equal(
    view.text("priceStructureText"),
    "개당 정가 34,000원 × 2개 = 정가 총액 68,000원, 개당 판매가 35,400원 × 2개 = 총판매액 70,800원"
  );
});

test("A-type coupon is per item while both shipping amounts stay per order", () => {
  const view = runCalculator({
    listPrice: "34000",
    quantity: "3",
    salePrice: "35400",
    purchaseType: "A",
    couponEnabled: true,
    shippingIncome: "15000"
  });

  assert.match(view.text("formulaCell"), /× 3개 \+ 3,000원\(배송비 보정 1회\)$/);
  assert.equal(view.text("costCell"), "76,971원");
  assert.equal(view.text("totalSalePriceCell"), "106,200원");
  assert.equal(view.text("settlementCell"), "108,456원");
  assert.equal(view.text("profitCell"), "31,485원");
});

test("C-type excludes purchase shipping and customer shipping is added once", () => {
  const view = runCalculator({
    listPrice: "34000",
    quantity: "3",
    salePrice: "35400",
    purchaseType: "C",
    shippingIncome: "15000"
  });

  assert.doesNotMatch(view.text("formulaCell"), /배송비 보정/);
  assert.equal(view.text("costCell"), "85,221원");
  assert.equal(view.text("settlementCell"), "108,456원");
  assert.equal(view.text("profitCell"), "23,235원");
});

test("Naver channel fee applies to the full quantity sale total", () => {
  const view = runCalculator({
    listPrice: "34000",
    quantity: "2",
    salePrice: "35400",
    channel: "naver",
    shippingIncome: "3000"
  });

  assert.equal(view.text("totalSalePriceCell"), "70,800원");
  assert.equal(view.text("settlementCell"), "69,906원");
  assert.equal(view.text("profitCell"), "13,092원");
});

test("BEP and target-margin tables remain order-total calculations", () => {
  const view = runCalculator({
    listPrice: "34000",
    quantity: "2",
    salePrice: "35400"
  });

  assert.equal(view.text("bepCell"), "64,562원");
  assert.equal(view.text("targetPriceCell"), "71,664원");
  assert.equal(view.text("recommendedCell"), "71,700원");
  assert.match(view.html("targetRows"), /<td class="num">11%<\/td>[\s\S]*?<td class="num">71,664원<\/td>[\s\S]*?<td class="num">71,700원<\/td>/);
});

test("all purchase types, channels, coupon states, quantities, and shipping use one total basis", () => {
  const types = ["A", "B", "C", "D", "auction", "naverBuy"];
  const channels = { coupang: 0.88, naver: 0.945 };

  for (const purchaseType of types) {
    for (const [channel, channelRate] of Object.entries(channels)) {
      for (const couponEnabled of [false, true]) {
        for (const quantity of [1, 2, 3]) {
          for (const shippingIncome of [0, 3000]) {
            const listPrice = 34000;
            const salePrice = 35400;
            const unit = expectedUnitCost(purchaseType, listPrice, couponEnabled);
            const cost = unit.cost * quantity + unit.orderShippingCredit;
            const totalSale = salePrice * quantity;
            const settlement = totalSale * channelRate + shippingIncome;
            const profit = settlement - cost;
            const view = runCalculator({
              listPrice: String(listPrice),
              quantity: String(quantity),
              salePrice: String(salePrice),
              purchaseType,
              channel,
              couponEnabled,
              shippingIncome: String(shippingIncome)
            });

            assert.equal(view.text("costCell"), formatWon(cost));
            assert.equal(view.text("totalSalePriceCell"), formatWon(totalSale));
            assert.equal(view.text("settlementCell"), formatWon(settlement));
            assert.equal(view.text("profitCell"), formatWon(profit));
          }
        }
      }
    }
  }
});

test("blank and zero numeric inputs stay finite and quantity falls back to one", () => {
  for (const quantity of ["", "0"]) {
    const view = runCalculator({
      listPrice: "",
      quantity,
      salePrice: "",
      shippingIncome: ""
    });

    assert.equal(view.text("costCell"), "0원");
    assert.equal(view.text("totalSalePriceCell"), "0원");
    assert.equal(view.text("settlementCell"), "0원");
    assert.equal(view.text("profitCell"), "0원");
    assert.equal(view.text("roiCell"), "0.00%");
    assert.doesNotMatch(view.html("targetRows"), /NaN|Infinity/);
  }

  for (const quantity of ["", "0"]) {
    const view = runCalculator({
      listPrice: "34000",
      quantity,
      salePrice: "35400"
    });

    assert.equal(view.text("costCell"), "28,407원");
    assert.equal(view.text("totalSalePriceCell"), "35,400원");
  }
});

test("labels explain per-item price and per-order shipping semantics", () => {
  assert.match(html, /<label>정가 \(개당\)/);
  assert.match(html, /<label>고객 배송료 \(주문당 1회\)/);
  assert.match(html, /<label>현재 판매가 검산 \(개당\)/);
  assert.match(html, /<th>총판매액<\/th>/);
});
