#!/usr/bin/env python3
import importlib.util
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("collect_discounts", ROOT / "scripts" / "collect_discounts.py")
COLLECTOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COLLECTOR)


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


if __name__ == "__main__":
    unittest.main()
