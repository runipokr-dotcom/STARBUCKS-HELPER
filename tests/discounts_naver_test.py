#!/usr/bin/env python3
import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest
from datetime import datetime, timedelta


ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("collect_discounts", ROOT / "scripts" / "collect_discounts.py")
COLLECTOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COLLECTOR)
sys.modules["collect_discounts"] = COLLECTOR
UPDATE_SPEC = importlib.util.spec_from_file_location(
    "update_naver_snapshot", ROOT / "scripts" / "update_naver_snapshot.py"
)
UPDATER = importlib.util.module_from_spec(UPDATE_SPEC)
UPDATE_SPEC.loader.exec_module(UPDATER)


class NaverCardParserTest(unittest.TestCase):
    def parse(self, text, **overrides):
        card = {
            "url": "https://brand.naver.com/starbucks/products/12214848212",
            "name": "[스타벅스] SS 단테 텀블러 710ml, 쿨핑크",
            "image": "https://shop-phinf.pstatic.net/sample.png?type=f80_80",
            "text": text,
        }
        card.update(overrides)
        return COLLECTOR.parse_naver_card(card)

    def test_public_fixed_discount(self):
        row = self.parse("49,000원 15% 할인 41,650원 무료배송")
        self.assertEqual(row["store"], "naver")
        self.assertEqual(row["id"], "12214848212")
        self.assertEqual(row["name"], "SS 단테 텀블러 710ml, 쿨핑크")
        self.assertEqual((row["originalPrice"], row["price"], row["rate"]), (49000, 41650, 15))
        self.assertFalse(row["soldOut"])

    def test_bundle_markdown_and_sold_out(self):
        row = self.parse("49,200원 16% 할인 41,000원 최대할인가 36,490원 품절")
        self.assertEqual((row["originalPrice"], row["price"], row["rate"]), (49200, 41000, 16))
        self.assertTrue(row["soldOut"])

    def test_coupon_maximum_price_only_is_excluded(self):
        self.assertIsNone(self.parse("17,600원 최대할인가 15,660원 11% 쿠폰 받기"))

    def test_non_official_product_url_is_excluded(self):
        self.assertIsNone(self.parse(
            "49,000원 15% 할인 41,650원",
            url="https://smartstore.naver.com/another-seller/products/12214848212",
        ))

    def test_invalid_or_mismatched_prices_are_excluded(self):
        self.assertIsNone(self.parse("41,650원 15% 할인 49,000원"))
        self.assertIsNone(self.parse("49,000원 80% 할인 41,650원"))

    def test_non_https_image_is_removed(self):
        row = self.parse("49,000원 15% 할인 41,650원", image="javascript:alert(1)")
        self.assertEqual(row["image"], "")

    def test_duplicate_same_price_merges_sold_out_state(self):
        rows, conflicts = {}, set()
        first = self.parse("49,000원 15% 할인 41,650원")
        second = self.parse("49,000원 15% 할인 41,650원 품절", image="")
        COLLECTOR.merge_naver_row(rows, conflicts, first)
        COLLECTOR.merge_naver_row(rows, conflicts, second)
        self.assertTrue(rows["12214848212"]["soldOut"])
        self.assertTrue(rows["12214848212"]["image"].startswith("https://"))
        self.assertEqual(conflicts, set())

    def test_conflicting_prices_are_removed(self):
        rows, conflicts = {}, set()
        first = self.parse("49,000원 15% 할인 41,650원")
        second = self.parse("49,000원 20% 할인 39,200원")
        COLLECTOR.merge_naver_row(rows, conflicts, first)
        COLLECTOR.merge_naver_row(rows, conflicts, second)
        self.assertNotIn("12214848212", rows)
        self.assertEqual(conflicts, {"12214848212"})


class NaverWorkSnapshotTest(unittest.TestCase):
    observed = datetime(2026, 11, 5, 12, 0, tzinfo=COLLECTOR.KST)

    def payload(self):
        return {
            "source": "work-browser",
            "observedAt": self.observed.isoformat(),
            "scanned": 2,
            "cards": [
                {
                    "url": "https://brand.naver.com/starbucks/products/12214848212",
                    "name": "[스타벅스] SS 단테 텀블러 710ml, 쿨핑크",
                    "image": "https://shop-phinf.pstatic.net/sample.png",
                    "text": "49,000원 15% 할인 41,650원",
                },
                {
                    "url": "https://brand.naver.com/starbucks/products/13544908348",
                    "name": "[스타벅스] 햄치즈 에그갈릭 토스트 4개입",
                    "image": "https://shop-phinf.pstatic.net/food.png",
                    "text": "17,600원 최대할인가 15,660원 11% 쿠폰",
                },
            ],
        }

    def test_build_snapshot_excludes_coupon_only_card(self):
        snapshot = UPDATER.build_snapshot(self.payload(), now=self.observed + timedelta(minutes=5))
        self.assertEqual(snapshot["source"], "work-browser")
        self.assertEqual(snapshot["scanned"], 2)
        self.assertEqual(len(snapshot["items"]), 1)
        self.assertEqual(snapshot["items"][0]["id"], "12214848212")

    def test_atomic_write_and_fresh_load(self):
        snapshot = UPDATER.build_snapshot(self.payload(), now=self.observed + timedelta(minutes=5))
        with tempfile.TemporaryDirectory() as td:
            path = pathlib.Path(td) / "naver-discounts.json"
            UPDATER.write_snapshot(snapshot, path)
            rows, scanned, meta = COLLECTOR.load_naver_snapshot(
                path, now=self.observed + timedelta(hours=17)
            )
            self.assertEqual(len(rows), 1)
            self.assertEqual(scanned, 2)
            self.assertEqual(meta["source"], "work-browser")
            self.assertEqual(meta["lastSuccessAt"], self.observed.isoformat())
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["version"], 1)

    def test_snapshot_older_than_18_hours_is_rejected(self):
        snapshot = UPDATER.build_snapshot(self.payload(), now=self.observed + timedelta(minutes=5))
        with tempfile.TemporaryDirectory() as td:
            path = pathlib.Path(td) / "naver-discounts.json"
            UPDATER.write_snapshot(snapshot, path)
            with self.assertRaisesRegex(RuntimeError, "19시간 전"):
                COLLECTOR.load_naver_snapshot(path, now=self.observed + timedelta(hours=19))

    def test_future_snapshot_is_rejected(self):
        payload = self.payload()
        payload["observedAt"] = (self.observed + timedelta(minutes=10)).isoformat()
        with self.assertRaisesRegex(RuntimeError, "미래"):
            UPDATER.build_snapshot(payload, now=self.observed)

    def test_duplicate_snapshot_item_is_rejected(self):
        snapshot = UPDATER.build_snapshot(self.payload(), now=self.observed + timedelta(minutes=5))
        snapshot["items"].append(dict(snapshot["items"][0]))
        snapshot["scanned"] = 2
        with tempfile.TemporaryDirectory() as td:
            path = pathlib.Path(td) / "naver-discounts.json"
            path.write_text(json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "중복 상품번호"):
                COLLECTOR.load_naver_snapshot(path, now=self.observed + timedelta(hours=1))

    def test_main_preserves_previous_naver_items_when_work_check_fails(self):
        previous_item = UPDATER.build_snapshot(
            self.payload(), now=self.observed + timedelta(minutes=5)
        )["items"][0]
        previous_item["firstSeen"] = self.observed.isoformat()
        previous = {
            "version": 1,
            "updatedAt": self.observed.isoformat(),
            "stores": {
                "naver": {
                    "name": "네이버 공식스토어", "ok": True, "checkedAt": self.observed.isoformat(),
                    "lastSuccessAt": self.observed.isoformat(), "scanned": 2, "discounted": 1,
                    "error": "", "source": "work-browser", "snapshotAt": self.observed.isoformat(),
                }
            },
            "items": [previous_item],
        }
        old_out, old_collectors = COLLECTOR.OUT, COLLECTOR.COLLECTORS
        try:
            with tempfile.TemporaryDirectory() as td:
                COLLECTOR.OUT = str(pathlib.Path(td) / "discounts.json")
                pathlib.Path(COLLECTOR.OUT).write_text(
                    json.dumps(previous, ensure_ascii=False), encoding="utf-8"
                )
                healthy = COLLECTOR.item(
                    "musinsa", "1", "정상 상품", "https://www.musinsa.com/products/1",
                    "https://image.example/1.png", 9000, 10000, 10,
                )
                COLLECTOR.COLLECTORS = {
                    "musinsa": lambda: ([healthy], 1),
                    "naver": lambda: (_ for _ in ()).throw(RuntimeError("Work 확인 실패")),
                }
                COLLECTOR.main()
                result = json.loads(pathlib.Path(COLLECTOR.OUT).read_text(encoding="utf-8"))
                naver_rows = [row for row in result["items"] if row["store"] == "naver"]
                self.assertEqual(len(naver_rows), 1)
                self.assertFalse(result["stores"]["naver"]["ok"])
                self.assertEqual(result["stores"]["naver"]["lastSuccessAt"], self.observed.isoformat())
                self.assertEqual(result["stores"]["naver"]["source"], "work-browser")
                self.assertEqual(result["stores"]["naver"]["snapshotAt"], self.observed.isoformat())
        finally:
            COLLECTOR.OUT, COLLECTOR.COLLECTORS = old_out, old_collectors


if __name__ == "__main__":
    unittest.main()
