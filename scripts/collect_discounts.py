#!/usr/bin/env python3
"""
STARBUCKS HELPER - 할인 레이더 수집기
File    : scripts/collect_discounts.py
Version : 1.1
Updated : 2026-11-05
Run by  : .github/workflows/discounts.yml (하루 2회, 09:00 / 18:00 KST 무렵)

판매처별 스타벅스 브랜드관에서 "지금 할인 중인 상품"만 모아 discounts.json 으로 저장한다.
- 정적 판매처는 표준 라이브러리, 동적 판매처는 Playwright/Chromium 사용
- 판매처별로 따로 실행: 한 곳이 실패해도 나머지는 갱신되고, 실패한 곳은 직전 데이터를 유지한다.
- firstSeen(처음 할인 발견 시각)은 이전 discounts.json 에서 이어받는다.
- 네이버는 공개 고정 할인가만 수집하고 계정별 쿠폰 최대가는 제외한다.
"""
import html
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "discounts.json")

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")

STORE_NAMES = {"musinsa": "무신사", "29cm": "29CM", "wconcept": "W컨셉",
               "kakao": "카카오 선물하기", "naver": "네이버 공식스토어"}

NAVER_HOME = "https://brand.naver.com/starbucks"
NAVER_PRODUCT_RE = re.compile(r"^https://brand\.naver\.com/starbucks/products/(\d+)(?:[/?#]|$)")
NAVER_FIXED_DISCOUNT_RE = re.compile(
    r"(?P<original>[\d,]+)원\s+(?P<rate>\d{1,2})%\s*할인\s+(?P<price>[\d,]+)원"
)

# W컨셉 웹사이트 프런트가 공개적으로 사용하는 조회용 키 (사이트 JS에 포함된 값, 개인 인증정보 아님)
WCONCEPT_KEY = "VWmkUPgs6g2fviPZ5JQFQ3pERP4tIXv/J2jppLqSRBk="


def now_iso():
    return datetime.now(KST).replace(microsecond=0).isoformat()


def request(url, *, data=None, headers=None, retries=2):
    h = {"User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9", "Accept": "*/*"}
    h.update(headers or {})
    body = json.dumps(data).encode("utf-8") if data is not None else None
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, data=body, headers=h, method="POST" if body else "GET")
            with urllib.request.urlopen(req, timeout=25) as res:
                return res.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 + attempt * 3)
    raise RuntimeError(f"{url[:80]} -> {last}")


def to_int(v):
    if v is None:
        return 0
    if isinstance(v, (int, float)):
        return int(v)
    s = re.sub(r"[^\d]", "", str(v))
    return int(s) if s else 0


def item(store, id_, name, url, image, price, original, rate, sold_out=False, extra=None):
    price, original = to_int(price), to_int(original)
    rate = to_int(rate)
    if not rate and original > price > 0:
        rate = round((original - price) * 100 / original)
    d = {
        "store": store,
        "id": str(id_),
        "name": html.unescape(str(name or "")).strip(),
        "url": url,
        "image": image or "",
        "price": price,
        "originalPrice": original,
        "rate": rate,
        "soldOut": bool(sold_out),
    }
    if extra:
        d.update(extra)
    return d


def parse_naver_card(card):
    """공식 상품 카드의 공개 고정 할인가만 표준 item 형식으로 바꾼다."""
    url = str(card.get("url") or "").split("?", 1)[0]
    product_match = NAVER_PRODUCT_RE.match(url)
    if not product_match:
        return None

    text = re.sub(r"\s+", " ", str(card.get("text") or "")).strip()
    discount_match = NAVER_FIXED_DISCOUNT_RE.search(text)
    if not discount_match:
        # "최대할인가"만 있는 계정별 쿠폰 상품은 이 경로로 제외된다.
        return None

    original = to_int(discount_match.group("original"))
    price = to_int(discount_match.group("price"))
    rate = to_int(discount_match.group("rate"))
    if not (original > price > 0 and 0 < rate < 100):
        return None
    calculated_rate = round((original - price) * 100 / original)
    if abs(calculated_rate - rate) > 1:
        return None

    name = html.unescape(str(card.get("name") or "")).strip()
    name = re.sub(r"^\[스타벅스\]\s*", "", name)
    if not name:
        return None
    image = str(card.get("image") or "")
    if image and not image.startswith("https://"):
        image = ""
    return item("naver", product_match.group(1), name, url, image, price, original, rate,
                "품절" in text)


def merge_naver_row(rows_by_id, conflicts, parsed):
    """같은 상품의 동일 가격은 합치고, 서로 다른 가격은 오표시 방지를 위해 제외한다."""
    old = rows_by_id.get(parsed["id"])
    signature = (parsed["originalPrice"], parsed["price"], parsed["rate"])
    old_signature = ((old or {}).get("originalPrice"), (old or {}).get("price"), (old or {}).get("rate"))
    if old and signature != old_signature:
        conflicts.add(parsed["id"])
        rows_by_id.pop(parsed["id"], None)
        return
    if parsed["id"] in conflicts:
        return
    if old:
        parsed["soldOut"] = old["soldOut"] or parsed["soldOut"]
        parsed["image"] = parsed["image"] or old["image"]
    rows_by_id[parsed["id"]] = parsed


# ---------------------------------------------------------------- 무신사
def collect_musinsa():
    out, total = [], 0
    for page in range(1, 6):
        url = ("https://api.musinsa.com/api2/dp/v2/plp/goods?gf=A&sortCode=DISCOUNT_RATE"
               f"&brand=starbucks&page={page}&size=60&caller=FLAGSHIP")
        j = json.loads(request(url, headers={"Origin": "https://www.musinsa.com",
                                             "Referer": "https://www.musinsa.com/"}))
        data = j.get("data") or {}
        rows = data.get("list") or []
        total = (data.get("pagination") or {}).get("totalCount") or total
        hit = 0
        for g in rows:
            rate = to_int(g.get("saleRate"))
            if rate <= 0:
                continue
            hit += 1
            out.append(item("musinsa", g.get("goodsNo"), g.get("goodsName"),
                            g.get("goodsLinkUrl") or f"https://www.musinsa.com/products/{g.get('goodsNo')}",
                            g.get("thumbnail"), g.get("price"), g.get("normalPrice"), rate,
                            g.get("isSoldOut")))
        # 할인율순 정렬이므로 이번 페이지에 할인 아닌 상품이 섞이면 다음 페이지는 볼 필요 없음
        if hit < len(rows) or not (data.get("pagination") or {}).get("hasNext"):
            break
    return out, total


# ---------------------------------------------------------------- 29CM
def collect_29cm():
    out, total = [], 0
    for page in range(1, 11):
        url = ("https://search-api.29cm.co.kr/api/v4/products/brand?frontBrandNo=104781"
               f"&count=100&page={page}&sort=new")
        j = json.loads(request(url, headers={"Origin": "https://www.29cm.co.kr",
                                             "Referer": "https://www.29cm.co.kr/"}))
        rows = ((j.get("data") or {}).get("products")) or []
        total += len(rows)
        for p in rows:
            s = p.get("saleInfoV2") or {}
            rate = to_int(s.get("totalSaleRate"))
            if rate <= 0:
                continue
            img = p.get("imageUrl") or ""
            if img.startswith("/"):
                img = "https://img.29cm.co.kr" + img
            out.append(item("29cm", p.get("itemNo"), p.get("itemName"),
                            f"https://www.29cm.co.kr/products/{p.get('itemNo')}", img,
                            s.get("totalSellPrice") or p.get("sellPrice"),
                            s.get("consumerPrice") or p.get("consumerPrice"), rate,
                            p.get("isSoldOut"),
                            {"coupon": bool(s.get("isCoupon"))}))
        if len(rows) < 100:
            break
    return out, total


# ---------------------------------------------------------------- W컨셉
def collect_wconcept():
    out, total = [], 0
    headers = {"Content-Type": "application/json; charset=utf-8", "DISPLAY-API-KEY": WCONCEPT_KEY,
               "Origin": "https://display.wconcept.co.kr", "Referer": "https://display.wconcept.co.kr/"}
    pages = 1
    page = 1
    while page <= min(pages, 10):
        j = json.loads(request("https://gw-front.wconcept.co.kr/display/api/brand/v1/products/116134",
                               data={"pageNo": page, "pageSize": 60}, headers=headers))
        data = j.get("data") or {}
        pages = to_int(data.get("totalPages")) or 1
        total = to_int(data.get("totalElements")) or total
        for p in data.get("content") or []:
            rate = to_int(p.get("finalDiscountRate"))
            if rate <= 0:
                continue
            code = p.get("itemCd")
            out.append(item("wconcept", code, p.get("itemName"),
                            f"https://www.wconcept.co.kr/Product/{code}", p.get("productImageUrl"),
                            p.get("finalPrice"), p.get("customerPrice"), rate,
                            str(p.get("statusCd")) not in ("01", "1")))
        page += 1
    return out, total


# ---------------------------------------------------------------- 카카오 선물하기 (스타벅스 공식스토어만)
def collect_kakao():
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(user_agent=UA, locale="ko-KR")
        page.goto("https://gift.kakao.com/brand/11297", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector('a.link_prdunit[href^="/product/"]', timeout=60000)
        discounted = page.locator("li:has(.num_sale)")
        for index in range(discounted.count()):
            discounted.nth(index).scroll_into_view_if_needed()
        page.wait_for_timeout(1000)
        cards = page.locator("li:has(a.link_prdunit)").evaluate_all("""els => els.map(el => ({
          url: el.querySelector('a.link_prdunit')?.getAttribute('href') || '',
          brandUrl: el.querySelector('a.link_prdbrand')?.getAttribute('href') || '',
          brand: el.querySelector('.txt_prdbrand')?.textContent?.trim() || '',
          name: el.querySelector('.txt_prdname')?.textContent?.trim() || '',
          image: el.querySelector('img.img_thumb')?.src || '',
          price: el.querySelector('.num_price')?.textContent?.trim() || '',
          rate: el.querySelector('.num_sale')?.textContent?.trim() || ''
        }))""")
        browser.close()

    official, seen = [], set()
    for card in cards:
        if card.get("brandUrl") != "/brand/11297" or card.get("brand") != "스타벅스(공식스토어)":
            continue
        id_ = str(card.get("url") or "").rstrip("/").split("/")[-1]
        if not id_.isdigit() or id_ in seen:
            continue
        seen.add(id_)
        if to_int(card.get("rate")) <= 0:
            continue
        official.append(item("kakao", id_, card.get("name"),
                             f"https://gift.kakao.com/product/{id_}", card.get("image"),
                             card.get("price"), 0, card.get("rate")))
    return official, len(seen)


# ---------------------------------------------------------------- 네이버 공식 브랜드스토어
def collect_naver():
    from playwright.sync_api import sync_playwright

    raw_cards = []
    story_urls = []
    story_pages_with_cards = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(user_agent=UA, locale="ko-KR")
        page.goto(NAVER_HOME, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector('a[href*="/starbucks/products/"]', timeout=60000)

        description = page.locator('meta[name="description"]').get_attribute("content") or ""
        if "스타벅스" not in description or "공식 브랜드 스토어" not in description:
            browser.close()
            raise RuntimeError("네이버 스타벅스 공식 브랜드스토어 확인 실패")

        story_urls = page.locator('a[href*="/starbucks/shoppingstory/detail"]').evaluate_all(r"""els => {
          const urls = [];
          for (const a of els) {
            try {
              const parsed = new URL(a.href);
              const id = parsed.searchParams.get('id');
              if (parsed.origin === 'https://brand.naver.com' && parsed.pathname === '/starbucks/shoppingstory/detail'
                  && /^\d+$/.test(id || '')) {
                urls.push(`https://brand.naver.com/starbucks/shoppingstory/detail?id=${id}`);
              }
            } catch (_) {}
          }
          return [...new Set(urls)];
        }""")
        if not story_urls:
            browser.close()
            raise RuntimeError("현재 쇼핑스토리 링크를 읽지 못함 — 사이트 구조 변경 또는 차단 의심")
        if len(story_urls) > 20:
            browser.close()
            raise RuntimeError(f"쇼핑스토리 링크가 비정상적으로 많음: {len(story_urls)}")

        def read_cards():
            return page.locator('a[href*="/starbucks/products/"]').evaluate_all(r"""els => {
              const cards = new Map();
              for (const a of els) {
                const url = (a.href || '').split('?')[0];
                if (!/^https:\/\/brand\.naver\.com\/starbucks\/products\/\d+$/.test(url) || cards.has(url)) continue;
                const root = a.parentElement?.parentElement;
                const meta = {};
                try {
                  for (const entry of JSON.parse(root?.getAttribute('data-shp-contents-dtl') || '[]')) {
                    meta[entry.key] = entry.value;
                  }
                } catch (_) {}
                const image = root?.querySelector('img');
                cards.set(url, {
                  url,
                  name: meta.chnl_prod_nm || image?.alt || '',
                  image: image?.src || '',
                  text: (root?.innerText || '').replace(/\s+/g, ' ').trim()
                });
              }
              return [...cards.values()];
            }""")

        raw_cards.extend(read_cards())
        for story_url in story_urls:
            page.goto(story_url, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_selector("body", timeout=30000)
            try:
                page.wait_for_selector('a[href*="/starbucks/products/"]', timeout=15000)
            except Exception:  # 행사 설명만 있고 상품 카드가 없는 쇼핑스토리도 허용
                continue
            story_pages_with_cards += 1
            raw_cards.extend(read_cards())

            section_hrefs = page.locator('a[href*="-shopping-story-detail"]').evaluate_all(
                "els => [...new Set(els.map(a => a.getAttribute('href')).filter(Boolean))]"
            )
            for section_href in section_hrefs:
                page.locator(f'a[href="{section_href}"]').first.click()
                page.wait_for_timeout(350)
                raw_cards.extend(read_cards())
        browser.close()

    if not story_pages_with_cards:
        raise RuntimeError("쇼핑스토리 상품 카드를 읽지 못함 — 사이트 구조 변경 또는 차단 의심")
    scanned_ids = set()
    rows_by_id = {}
    conflicts = set()
    for card in raw_cards:
        product_match = NAVER_PRODUCT_RE.match(str(card.get("url") or ""))
        if product_match:
            scanned_ids.add(product_match.group(1))
        parsed = parse_naver_card(card)
        if not parsed:
            continue
        merge_naver_row(rows_by_id, conflicts, parsed)

    if not scanned_ids:
        raise RuntimeError("공식 상품 카드를 0건 읽음 — 사이트 구조 변경 또는 차단 의심")
    if conflicts:
        print(f"[warn] naver: conflicting prices excluded={len(conflicts)}", file=sys.stderr)
    return list(rows_by_id.values()), len(scanned_ids)


COLLECTORS = {"musinsa": collect_musinsa, "29cm": collect_29cm,
              "wconcept": collect_wconcept, "kakao": collect_kakao,
              "naver": collect_naver}


def load_previous():
    try:
        with open(OUT, encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return {}


def main():
    prev = load_previous()
    prev_items = prev.get("items") or []
    prev_first = {f"{i.get('store')}:{i.get('id')}": i.get("firstSeen") for i in prev_items}
    prev_stores = prev.get("stores") or {}
    stamp = now_iso()

    items, stores = [], {}
    for key, fn in COLLECTORS.items():
        try:
            rows, total = fn()
            if not total:
                raise RuntimeError("상품 목록을 0건 읽음 — 사이트 구조 변경 또는 차단 의심")
            for r in rows:
                r["firstSeen"] = prev_first.get(f"{key}:{r['id']}") or stamp
            items.extend(rows)
            stores[key] = {"name": STORE_NAMES[key], "ok": True, "checkedAt": stamp,
                           "lastSuccessAt": stamp, "scanned": total, "discounted": len(rows), "error": ""}
            print(f"[ok] {key}: scanned={total} discounted={len(rows)}")
        except Exception as e:  # noqa: BLE001
            kept = [i for i in prev_items if i.get("store") == key]
            items.extend(kept)
            old = prev_stores.get(key) or {}
            stores[key] = {"name": STORE_NAMES[key], "ok": False, "checkedAt": stamp,
                           "lastSuccessAt": old.get("lastSuccessAt", ""), "scanned": old.get("scanned", 0),
                           "discounted": len(kept), "error": str(e)[:300]}
            print(f"[fail] {key}: {e}", file=sys.stderr)

    items.sort(key=lambda i: (-i["rate"], i["store"], i["name"]))
    result = {"version": 1, "updatedAt": stamp, "stores": stores, "items": items}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
        f.write("\n")
    if not any(s["ok"] for s in stores.values()):
        sys.exit(1)


if __name__ == "__main__":
    main()
