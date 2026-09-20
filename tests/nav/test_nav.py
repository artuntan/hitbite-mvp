import importlib.util
import unittest
from datetime import date
from decimal import Decimal as D
from pathlib import Path
from unittest.mock import call, patch

spec = importlib.util.spec_from_file_location("hb", Path(__file__).parents[2] / "nav_engine/hb.py")
hb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hb)


class NavTests(unittest.TestCase):
    def test_confirmed_snapshot_retries_the_same_block_without_republishing(self):
        error = RuntimeError("Provider error containing private request details")
        error.response = type("Response", (), {"status_code": 400})()
        snapshot = {"block_number": 42, "nav_units": "1000000"}
        with patch.object(hb, "live_nav", side_effect=[error, error, snapshot]) as read, \
                patch.object(hb.time, "sleep") as wait:
            self.assertEqual(hb.confirmed_nav(42), snapshot)
            self.assertEqual(read.call_args_list, [call(42)] * 3)
            self.assertEqual(wait.call_count, 2)
        with patch.object(hb, "live_nav", side_effect=ValueError("Invalid model")) as read, \
                patch.object(hb.time, "sleep") as wait:
            with self.assertRaises(ValueError):
                hb.confirmed_nav(42)
            read.assert_called_once_with(42)
            wait.assert_not_called()
        with patch.object(hb, "live_nav", side_effect=error) as read, patch.object(hb.time, "sleep"):
            with self.assertRaises(RuntimeError):
                hb.confirmed_nav(42)
            self.assertEqual(read.call_count, 8)

    def test_failure_report_never_includes_provider_message_or_credentials(self):
        error = RuntimeError("https://provider.invalid/private-token request body and signing data")
        error.response = type("Response", (), {"status_code": 400})()
        report = hb.failure_summary(error)
        self.assertIn("RuntimeError", report)
        self.assertIn("HTTP 400", report)
        self.assertNotIn("private-token", report)
        self.assertNotIn("request body", report)
        self.assertNotIn("provider.invalid", report)

    def setUp(self):
        self.holding = {"coupon": "0.06", "maturity": "2029-09-20"}

    def test_par_coupon_date_yield_and_dirty(self):
        dirty, accrued, ytm, upcoming = hb.bond(self.holding, D(100), date(2026, 9, 20))
        self.assertEqual(dirty, 100)
        self.assertEqual(accrued, 0)
        self.assertLess(abs(ytm - D("0.06")), D("1e-20"))
        self.assertEqual(upcoming, date(2027, 3, 20))

    def test_actual_days_dirty_price(self):
        dirty, accrued, _, _ = hb.bond(self.holding, D(98), date(2026, 12, 19))
        expected = D(3) * D(90) / D(181)
        self.assertEqual(accrued, expected)
        self.assertEqual(dirty, 98 + expected)

    def test_premium_yield_is_below_coupon(self):
        self.assertLess(hb.bond(self.holding, D(105), date(2026, 9, 20))[2], D("0.06"))

    def test_reference_scaling_and_usdc_rounding(self):
        a = hb.model(date(2026, 9, 21), D("0.5"))
        b = hb.model(date(2026, 9, 21), D("100000"))
        self.assertEqual(a["nav_units"], b["nav_units"])
        self.assertEqual(D(a["net_assets"]) * 200000, D(b["net_assets"]))
        exact = D(b["net_assets"]) / 100000
        self.assertTrue(D(0) <= exact - D(b["nav_per_token"]) < D("0.000001"))

    def test_fee_rates_actual_365(self):
        value = hb.model(date(2027, 9, 20), D(100000))
        self.assertEqual(D(value["fees"]["management_accrued"]), 750)
        self.assertEqual(D(value["fees"]["expenses_accrued"]), 300)

    def test_coupon_roll_keeps_cash_and_value(self):
        before = hb.model(date(2027, 3, 19), D(100000))
        after = hb.model(date(2027, 3, 20), D(100000))
        self.assertEqual(D(after["cash"]), 3234)
        self.assertGreater(D(after["net_assets"]), D(before["net_assets"]))
        self.assertLess(D(after["net_assets"]) - D(before["net_assets"]), 20)

    def test_zero_supply_is_explicit_not_infinite_backing(self):
        value = hb.model(date(2026, 9, 20), D(0))
        self.assertTrue(value["bootstrap"])
        self.assertIsNone(value["supply_backed_ratio"])
        self.assertEqual(value["nav_units"], "1000000")
        self.assertEqual(D(value["net_assets"]), 0)

    def test_pre_purchase_and_matured_fail_closed(self):
        with self.assertRaises(ValueError):
            hb.model(date(2026, 9, 19), D(1))
        with self.assertRaises(ValueError):
            hb.model(date(2029, 9, 20), D(1))

    def test_quote_dates_are_visible_and_never_look_ahead(self):
        value = hb.model(date(2026, 9, 21), D(1))
        self.assertEqual(value["holdings"][0]["price_date"], "2026-09-20")
        with self.assertRaises(ValueError):
            hb.model(date(2026, 9, 20), D(1), quotes=[{"id":"SIM-2029", "date":"2026-09-21", "clean_price":"110", "source":"simulation"}])

    def test_canonical_unicode_and_key_order(self):
        self.assertEqual(hb.canonical({"z": "Türkiye", "a": "1.000000"}), '{"a":"1.000000","z":"Türkiye"}')


if __name__ == "__main__":
    unittest.main()
