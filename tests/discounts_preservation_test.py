#!/usr/bin/env python3
import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "collect_discounts_preservation", ROOT / "scripts" / "collect_discounts.py"
)
COLLECTOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COLLECTOR)
sys.modules["collect_discounts_preservation"] = COLLECTOR


class CollectorMetadataPreservationTest(unittest.TestCase):
    stamp = "2026-11-17T18:00:00+09:00"

    def run_main(self, previous, collectors):
        old_out, old_collectors, old_now_iso = (
            COLLECTOR.OUT, COLLECTOR.COLLECTORS, COLLECTOR.now_iso,
        )
        try:
            with tempfile.TemporaryDirectory() as td:
                path = pathlib.Path(td) / "discounts.json"
                path.write_text(json.dumps(previous, ensure_ascii=False), encoding="utf-8")
                COLLECTOR.OUT = str(path)
                COLLECTOR.COLLECTORS = collectors
                COLLECTOR.now_iso = lambda: self.stamp
                COLLECTOR.main()
                return json.loads(path.read_text(encoding="utf-8"))
        finally:
            COLLECTOR.OUT, COLLECTOR.COLLECTORS, COLLECTOR.now_iso = (
                old_out, old_collectors, old_now_iso,
            )

    def previous(self, row, store_meta=None):
        store = row["store"]
        return {
            "version": 1,
            "updatedAt": "2026-11-17T16:00:00+09:00",
            "stores": {
                store: {
                    "name": COLLECTOR.STORE_NAMES[store], "ok": True,
                    "checkedAt": "2026-11-17T16:00:00+09:00",
                    "lastSuccessAt": "2026-11-17T16:00:00+09:00",
                    "scanned": 1, "discounted": 1, "error": "",
                    **(store_meta or {}),
                }
            },
            "items": [row],
        }

    def test_stable_row_keeps_only_unmanaged_metadata(self):
        old = COLLECTOR.item(
            "29cm", "1", "이전 이름", "https://old.example/1",
            "https://old.example/1.jpg", 9000, 10000, 10,
            extra={
                "firstSeen": "2026-11-16T10:00:00+09:00",
                "offerType": "coupon", "conditionalPrice": 8500,
                "conditionalLabel": "조건부 쿠폰", "verifiedAt": "2026-11-17T16:00:00+09:00",
                "verificationStatus": "verified",
            },
        )
        previous = self.previous(old, {
            "manualVerifiedAt": "2026-11-17T16:00:00+09:00",
            "manualVerifiedIds": ["1"], "manualOfferType": "coupon",
            "manualOfferNote": "조건부 쿠폰 직접 확인",
        })
        fresh = COLLECTOR.item(
            "29cm", "1", "새 수집 이름", "https://new.example/1",
            "https://new.example/1.jpg", 9000, 10000, 10,
        )
        result = self.run_main(previous, {"29cm": lambda: ([fresh], 1)})
        row = result["items"][0]
        self.assertEqual(row["name"], "새 수집 이름")
        self.assertEqual(row["url"], "https://new.example/1")
        self.assertEqual(row["image"], "https://new.example/1.jpg")
        self.assertEqual(row["conditionalPrice"], 8500)
        self.assertEqual(row["conditionalLabel"], "조건부 쿠폰")
        self.assertEqual(row["firstSeen"], "2026-11-16T10:00:00+09:00")
        self.assertEqual(result["stores"]["29cm"]["manualVerifiedIds"], ["1"])

    def test_changed_price_and_stock_drop_stale_verification_metadata(self):
        old = COLLECTOR.item(
            "29cm", "1", "상품", "https://old.example/1", "https://old.example/1.jpg",
            9000, 10000, 10, False,
            extra={
                "firstSeen": "2026-11-16T10:00:00+09:00", "offerType": "coupon",
                "conditionalPrice": 8500, "verifiedAt": "2026-11-17T16:00:00+09:00",
                "verificationStatus": "verified",
            },
        )
        previous = self.previous(old, {
            "manualVerifiedIds": ["1"], "manualVerifiedAt": "2026-11-17T16:00:00+09:00",
            "manualOfferType": "coupon", "manualOfferNote": "이전 조건",
        })
        fresh = COLLECTOR.item(
            "29cm", "1", "상품", "https://new.example/1", "https://new.example/1.jpg",
            8000, 10000, 20, True,
        )
        result = self.run_main(previous, {"29cm": lambda: ([fresh], 1)})
        row = result["items"][0]
        self.assertEqual((row["price"], row["rate"], row["soldOut"]), (8000, 20, True))
        self.assertNotIn("conditionalPrice", row)
        self.assertNotIn("verifiedAt", row)
        self.assertNotIn("verificationStatus", row)
        self.assertNotIn("manualVerifiedIds", result["stores"]["29cm"])

    def test_missing_manual_card_is_kept_but_expired_status_is_unverified(self):
        old = COLLECTOR.item(
            "musinsa", "6347243", "포포", "https://www.musinsa.com/products/6347243",
            "https://image.example/popo.jpg", 29000, 29000, 0, False,
            extra={
                "firstSeen": "2026-11-17T14:45:00+09:00", "offerType": "listed",
                "conditionalPrice": 26970, "conditionalLabel": "로그인 회원 혜택",
                "verifiedAt": "2026-11-17T14:45:00+09:00",
                "verificationStatus": "verified", "manualPinned": True,
                "manualExpiresAt": "2020-01-01T00:00:00+09:00",
            },
        )
        previous = self.previous(old)
        fresh = COLLECTOR.item(
            "musinsa", "2", "자동 수집 상품", "https://www.musinsa.com/products/2",
            "https://image.example/2.jpg", 9000, 10000, 10,
        )
        result = self.run_main(previous, {"musinsa": lambda: ([fresh], 2)})
        by_id = {row["id"]: row for row in result["items"]}
        self.assertEqual(set(by_id), {"2", "6347243"})
        self.assertEqual(by_id["6347243"]["verificationStatus"], "unverified")
        self.assertEqual(by_id["6347243"]["price"], 29000)
        self.assertEqual(by_id["6347243"]["conditionalPrice"], 26970)
        self.assertEqual(result["stores"]["musinsa"]["discounted"], 2)


if __name__ == "__main__":
    unittest.main()
