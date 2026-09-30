#!/usr/bin/env python3
"""
STARBUCKS HELPER - 할인 레이더 수집기
File    : scripts/collect_discounts.py
Version : 1.0
Updated : 2026-09-30
Run by  : .github/workflows/discounts.yml (하루 2회, 09:00 / 18:00 KST 무렵)

판매처별 스타벅스 브랜드관에서 "지금 할인 중인 상품"만 모아 discounts.json 으로 저장한다.
- 표준 라이브러리만 사용 (pip 설치 없음)
- 판매처별로 따로 실행: 한 곳이 실패해도 나머지는 갱신되고, 실패한 곳은 직전 데이터를 유지한다.
- firstSeen(처음 할인 발견 시각)은 이전 discounts.json 에서 이어받는다.
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

STORE_NAMES = {"musinsa": "무신사", "29cm": "29CM", "wconcept": "W컨셉", "ssg": "SSG"}

# SSG 스타벅스 브랜드관 중 MD(비식품) 카테고리만 수집 — 식품/음료/원두 묶음 제외
SSG_BRAND_ID = "2000016468"
SSG_CATEGORIES = {
    "6000174585": "주방용품",
    "6000200158": "가방/지갑",
    "6000200159": "모자/장갑/ACC",
    "6000174587": "생활잡화",
    "6000173877": "인테리어소품",
    "6000210428": "문구/취미",
    "6000204820": "캠핑",
    "6000204821": "골프",
}

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


# ---------------------------------------------------------------- SSG
SSG_LI = re.compile(r'<li class="cunit_t290">(.*?)</li>\s*(?=<li class="cunit_t290"|</ul>)', re.S)


def _grab(pattern, text):
    m = re.search(pattern, text, re.S)
    return m.group(1).strip() if m else ""


def parse_ssg(page_html, category=""):
    rows = []
    for block in SSG_LI.findall(page_html):
        rate = to_int(_grab(r'ssgitem_sale_rate">.*?<span class="blind">할인율</span>\s*<span>(\d+)%', block))
        if rate <= 0:
            continue
        id_ = _grab(r'data-react-unit-id="(\d+)"', block)
        name = _grab(r'<div class="ssgitem_tit_name">(.*?)</div>', block)
        link = html.unescape(_grab(r'<a href="(https://www\.ssg\.com/item/itemView\.ssg\?[^"]+)"', block))
        img = _grab(r'<img[^>]*?\ssrc="([^"]+)"', block)
        old = _grab(r'<span class="blind">정상가격</span>\s*<em>([\d,]+)', block)
        new = _grab(r'<span class="blind">판매가격</span>\s*<em>([\d,]+)', block)
        sold = "품절" in _grab(r'\[D\] 품절 레이어 -->(.{0,300})', block)
        if not id_ or not name:
            continue
        rows.append(item("ssg", id_, name, link or f"https://www.ssg.com/item/itemView.ssg?itemId={id_}",
                         img, new, old, rate, sold, {"category": category}))
    return rows


def collect_ssg():
    out, seen, total = [], set(), 0
    for ctg, label in SSG_CATEGORIES.items():
        url = (f"https://www.ssg.com/disp/brandShop.ssg?brandId={SSG_BRAND_ID}&ctgId={ctg}"
               "&sort=dcrt&pageSize=80")
        page = request(url, headers={"Accept": "text/html", "Referer": "https://www.ssg.com/"})
        total += len(SSG_LI.findall(page))
        for r in parse_ssg(page, label):
            if r["id"] in seen:
                continue
            seen.add(r["id"])
            out.append(r)
        time.sleep(1)
    return out, total


COLLECTORS = {"musinsa": collect_musinsa, "29cm": collect_29cm,
              "wconcept": collect_wconcept, "ssg": collect_ssg}


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
