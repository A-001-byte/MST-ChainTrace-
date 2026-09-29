"""Tests for src/graph_ml/geo_temporal.py — the Geo-Temporal Mismatch ("VPN Catcher")
detector — plus the blindness guarantee that makes scripts/score_vpn_catcher.py's
validation numbers meaningful.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path

import pandas as pd
import pytest

from src.graph_ml import geo_temporal as gt


# ---------------------------------------------------------------------------
# THE blindness guarantee — an executable check, not just a docstring promise.
# ---------------------------------------------------------------------------


def test_no_module_under_this_package_references_ground_truth_file():
    """geo_temporal.py (or anything else under src/graph_ml/) must never read, import, or
    even name-check geo_ground_truth.csv. Only scripts/score_vpn_catcher.py is allowed to
    — that split is what makes its precision/recall numbers a real validation result
    instead of "we detected our own generator". This test greps the detector's own
    package so that guarantee can't silently rot as the codebase changes.

    Scoped to src/graph_ml/, not the whole src/ tree: src/data_pipeline/network_synth.py
    legitimately writes geo_ground_truth.csv (it's the teammate's generator that plants
    the evasion cases in the first place) — that's the file's producer, not the detector,
    and this task explicitly rules src/data_pipeline/ out of scope to touch or second-guess.
    A blindness guarantee about the *detector* isn't violated by the *generator* knowing
    its own output filename; conflating the two would make this test impossible to
    satisfy without breaking already-merged, unrelated code.
    """
    package_root = Path(__file__).resolve().parents[2] / "src" / "graph_ml"
    offending_files = []
    for path in package_root.rglob("*.py"):
        text = path.read_text(encoding="utf-8", errors="ignore")
        if "geo_ground_truth" in text:
            offending_files.append(str(path))

    assert offending_files == [], (
        "geo_ground_truth.csv must never be referenced under src/graph_ml/ — found it in: "
        f"{offending_files}"
    )


def test_score_vpn_catcher_is_the_one_file_that_may_reference_it():
    # Sanity check on the test above: confirm the scoring script itself DOES reference
    # the ground-truth file, so we know the grep pattern isn't simply wrong/too narrow.
    script = Path(__file__).resolve().parents[2] / "scripts" / "score_vpn_catcher.py"
    assert "geo_ground_truth" in script.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# _parse_address_list
# ---------------------------------------------------------------------------


class TestParseAddressList:
    def test_parses_stringified_list(self):
        assert gt._parse_address_list("['addrA', 'addrB']") == ["addrA", "addrB"]

    def test_parses_single_address_list(self):
        assert gt._parse_address_list("['addrA']") == ["addrA"]

    def test_empty_list_string(self):
        assert gt._parse_address_list("[]") == []

    def test_none_returns_empty(self):
        assert gt._parse_address_list(None) == []

    def test_malformed_string_returns_empty_not_raise(self):
        assert gt._parse_address_list("not a list") == []

    def test_already_a_list_passes_through(self):
        assert gt._parse_address_list(["x", "y"]) == ["x", "y"]


# ---------------------------------------------------------------------------
# build_wallet_activity_index
# ---------------------------------------------------------------------------


class TestBuildWalletActivityIndex:
    def test_single_pass_builds_hour_and_country_counts(self):
        tx_df = pd.DataFrame(
            [
                {
                    "timestamp": "2015-01-01 03:00:00",
                    "geo_country": "US",
                    "input_addresses": "['addrA']",
                    "output_addresses": "['addrB']",
                },
                {
                    "timestamp": "2015-01-02 03:30:00",
                    "geo_country": "US",
                    "input_addresses": "['addrA']",
                    "output_addresses": "[]",
                },
            ]
        )
        index = gt.build_wallet_activity_index(tx_df)

        assert set(index.keys()) == {"addrA", "addrB"}
        assert index["addrA"].n_transactions == 2
        assert index["addrA"].utc_hour_counts == Counter({3: 2})
        assert index["addrA"].country_counts == Counter({"US": 2})
        assert index["addrB"].n_transactions == 1

    def test_invalid_timestamp_row_is_skipped_not_raised(self):
        tx_df = pd.DataFrame(
            [
                {"timestamp": "not-a-date", "geo_country": "US", "input_addresses": "['addrA']", "output_addresses": "[]"},
                {"timestamp": "2015-01-01 05:00:00", "geo_country": "US", "input_addresses": "['addrA']", "output_addresses": "[]"},
            ]
        )
        index = gt.build_wallet_activity_index(tx_df)
        assert index["addrA"].n_transactions == 1  # only the valid row counted


# ---------------------------------------------------------------------------
# _business_hour_fraction
# ---------------------------------------------------------------------------


class TestBusinessHourFraction:
    def test_all_activity_in_business_hours_gives_fraction_one(self):
        counts = Counter({10: 5, 14: 5})  # both already inside [9, 18) with offset 0
        assert gt._business_hour_fraction(counts, utc_offset=0) == 1.0

    def test_all_activity_outside_business_hours_gives_fraction_zero(self):
        counts = Counter({2: 5, 3: 5})
        assert gt._business_hour_fraction(counts, utc_offset=0) == 0.0

    def test_offset_shifts_which_hours_count(self):
        # 2am UTC becomes 10am local under a +8 offset -> inside business hours.
        counts = Counter({2: 4})
        assert gt._business_hour_fraction(counts, utc_offset=8) == 1.0
        assert gt._business_hour_fraction(counts, utc_offset=0) == 0.0

    def test_empty_counter_returns_zero(self):
        assert gt._business_hour_fraction(Counter(), utc_offset=0) == 0.0


# ---------------------------------------------------------------------------
# _evaluate_wallet
# ---------------------------------------------------------------------------


class TestEvaluateWallet:
    def _activity(self, hours: list[int], country: str, wallet_id: str = "w") -> gt.WalletActivity:
        a = gt.WalletActivity(wallet_id=wallet_id)
        for h in hours:
            a.utc_hour_counts[h] += 1
        a.country_counts[country] += len(hours)
        return a

    def test_too_few_transactions_is_not_flagged(self):
        a = self._activity(hours=[3, 3], country="US")  # below MIN_TRANSACTIONS_FOR_SIGNAL
        result = gt._evaluate_wallet(a)
        assert result["geo_temporal_flag"] is False
        assert result["geo_temporal_reason"] is None
        assert result["claimed_country"] is None  # never even got that far

    def test_unknown_claimed_country_is_not_flagged(self):
        # A country not in COUNTRY_UTC_OFFSET -> honest non-answer, not a guess.
        a = self._activity(hours=[3, 4, 5], country="ZZ")
        result = gt._evaluate_wallet(a)
        assert result["claimed_country"] == "ZZ"
        assert result["claimed_offset"] is None
        assert result["geo_temporal_flag"] is False

    def test_activity_matching_claimed_country_is_not_flagged(self):
        # US offset is -5. UTC hours 14,15,16 -> local 9,10,11 = squarely business hours.
        a = self._activity(hours=[14, 15, 16], country="US")
        result = gt._evaluate_wallet(a)
        assert result["claimed_business_fraction"] == 1.0
        assert result["geo_temporal_flag"] is False

    def test_genuine_mismatch_is_flagged_with_readable_reason(self):
        # Claims US (offset -5): UTC hours 1,2,3 -> local 20,21,22 -> NOT business hours.
        # Same UTC hours under China/Singapore (offset +8) -> local 9,10,11 -> business hours.
        a = self._activity(hours=[1, 2, 3], country="US")
        result = gt._evaluate_wallet(a)
        assert result["geo_temporal_flag"] is True
        assert result["alt_region"] == "Asia-Pacific"
        assert result["geo_temporal_reason"] == "claims US, but 100% of activity falls in Asia-Pacific business hours"

    def test_neighboring_offset_is_not_treated_as_a_mismatch(self):
        # UTC hour 8 lands in business hours under offset +1 (Western Europe, local=9)
        # but NOT under GB's own claimed offset 0 (local=8, one hour short) -- Western
        # Europe would score perfectly here, but it's only 1h from GB's offset, below
        # MIN_OFFSET_GAP_HOURS, so it must never be selected as the "alt" region. This
        # verifies the invariant directly (whichever eligible far-offset wins, if any,
        # must actually satisfy the gap) rather than asserting one specific winner.
        a = self._activity(hours=[8, 8, 8], country="GB")  # claimed offset 0
        result = gt._evaluate_wallet(a)
        assert result["claimed_business_fraction"] == 0.0  # confirms we reach the alt search
        if result["alt_region"] is not None:
            alt_offset = next(
                off for off, name in gt._OFFSET_REGION_NAMES.items() if name == result["alt_region"]
            )
            assert abs(alt_offset - 0) >= gt.MIN_OFFSET_GAP_HOURS


# ---------------------------------------------------------------------------
# detect_geo_temporal_mismatches — end to end on a small synthetic tx_df
# ---------------------------------------------------------------------------


class TestDetectGeoTemporalMismatches:
    def test_does_not_flag_every_wallet(self):
        # A mixed synthetic dataset: some wallets whose activity matches their claimed
        # country, some genuinely mismatched, some with too little data.
        rows = []
        # Wallet A: claims US, active at UTC 14-16 (US business hours) -> should NOT flag.
        for h in (14, 15, 16, 14, 15):
            rows.append({"timestamp": f"2015-01-01 {h:02d}:00:00", "geo_country": "US",
                         "input_addresses": "['walletA']", "output_addresses": "[]"})
        # Wallet B: claims US, active at UTC 1-3 (matches Asia-Pacific, not US) -> SHOULD flag.
        for h in (1, 2, 3, 1, 2):
            rows.append({"timestamp": f"2015-01-02 {h:02d}:00:00", "geo_country": "US",
                         "input_addresses": "['walletB']", "output_addresses": "[]"})
        # Wallet C: only 2 transactions -> too little data, should NOT flag.
        for h in (1, 2):
            rows.append({"timestamp": f"2015-01-03 {h:02d}:00:00", "geo_country": "US",
                         "input_addresses": "['walletC']", "output_addresses": "[]"})

        tx_df = pd.DataFrame(rows)
        result = gt.detect_geo_temporal_mismatches(tx_df)

        by_wallet = result.set_index("wallet_id")
        assert by_wallet.loc["walletA", "geo_temporal_flag"] == False
        assert by_wallet.loc["walletB", "geo_temporal_flag"] == True
        assert by_wallet.loc["walletC", "geo_temporal_flag"] == False

        # The core "not everything flagged" requirement, on this mixed set.
        assert result["geo_temporal_flag"].sum() < len(result)
        assert result["geo_temporal_flag"].sum() > 0

    def test_reads_default_path_when_no_df_given(self, tmp_path, monkeypatch):
        csv_path = tmp_path / "unified_dataset.csv"
        pd.DataFrame(
            [{"timestamp": "2015-01-01 14:00:00", "geo_country": "US",
              "input_addresses": "['walletX']", "output_addresses": "[]"}]
            * 3
        ).to_csv(csv_path, index=False)
        monkeypatch.setattr(gt, "UNIFIED_DATASET_CSV", csv_path)

        result = gt.detect_geo_temporal_mismatches()
        assert "walletX" in result["wallet_id"].tolist()


# ---------------------------------------------------------------------------
# join_geo_temporal_onto_alerts
# ---------------------------------------------------------------------------


class TestJoinGeoTemporalOntoAlerts:
    CONTRACT_B_COLS = [
        "node_id", "node_type", "label", "cluster_id", "classifier_confidence",
        "anomaly_score", "risk_score", "reason", "intent_label", "intent_confidence",
    ]

    def _alerts_df(self):
        return pd.DataFrame(
            [
                {**{c: "x" for c in self.CONTRACT_B_COLS}, "node_id": "wallet_addrA", "node_type": "wallet"},
                {**{c: "x" for c in self.CONTRACT_B_COLS}, "node_id": "wallet_addrB", "node_type": "wallet"},
                {**{c: "x" for c in self.CONTRACT_B_COLS}, "node_id": "wallet_addrUNSEEN", "node_type": "wallet"},
                {**{c: "x" for c in self.CONTRACT_B_COLS}, "node_id": "tx_999", "node_type": "tx"},
            ]
        )

    def _geo_df(self):
        return pd.DataFrame(
            [
                {"wallet_id": "addrA", "geo_temporal_flag": True, "geo_temporal_reason": "claims US, but 80% ..."},
                {"wallet_id": "addrB", "geo_temporal_flag": False, "geo_temporal_reason": None},
            ]
        )

    def test_contract_b_columns_are_untouched(self):
        alerts_df = self._alerts_df()
        original = alerts_df.copy()
        gt.join_geo_temporal_onto_alerts(alerts_df, self._geo_df())
        pd.testing.assert_frame_equal(alerts_df, original)  # input never mutated

    def test_wallet_rows_get_real_values(self):
        joined = gt.join_geo_temporal_onto_alerts(self._alerts_df(), self._geo_df())
        row_a = joined[joined["node_id"] == "wallet_addrA"].iloc[0]
        row_b = joined[joined["node_id"] == "wallet_addrB"].iloc[0]
        assert row_a["geo_temporal_flag"] is True
        assert "80%" in row_a["geo_temporal_reason"]
        assert row_b["geo_temporal_flag"] is False
        # geo_temporal_reason is a string column, so pandas (3.0+'s default "str" dtype)
        # stores an unset value as its own NaN sentinel rather than preserving the literal
        # Python None the join function assigned -- pd.isna() is the dtype-correct way to
        # check "missing" here; a bare `is None` would be testing a pandas storage detail,
        # not the actual contract. geo_temporal_flag has no such issue: mixing bool/None
        # keeps that column plain `object` dtype, where None survives as real None (see the
        # `is True`/`is False`/`is None` checks throughout this class).
        assert pd.isna(row_b["geo_temporal_reason"])

    def test_tx_type_rows_get_none_not_false(self):
        joined = gt.join_geo_temporal_onto_alerts(self._alerts_df(), self._geo_df())
        row = joined[joined["node_id"] == "tx_999"].iloc[0]
        assert row["geo_temporal_flag"] is None
        assert pd.isna(row["geo_temporal_reason"])

    def test_wallet_never_seen_in_unified_dataset_gets_none_not_false(self):
        joined = gt.join_geo_temporal_onto_alerts(self._alerts_df(), self._geo_df())
        row = joined[joined["node_id"] == "wallet_addrUNSEEN"].iloc[0]
        assert row["geo_temporal_flag"] is None
        assert pd.isna(row["geo_temporal_reason"])

    def test_result_is_json_serializable_with_missing_values(self):
        # Guards the "missing values must not crash the dashboard" requirement --
        # this is the same to_json()-then-json.loads() path src/webapp/server.py uses.
        import json

        joined = gt.join_geo_temporal_onto_alerts(self._alerts_df(), self._geo_df())
        payload = json.loads(joined.to_json(orient="records"))
        assert len(payload) == 4
        tx_row = next(r for r in payload if r["node_id"] == "tx_999")
        assert tx_row["geo_temporal_flag"] is None
