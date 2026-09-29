"""Key / bps / band / leaf-encoding tests."""

from __future__ import annotations

import json
import re
from decimal import Decimal
from pathlib import Path

import pytest
from eth_abi import encode as abi_encode

from src.mst import Band, Flag, Intent, LeafFields, address_key, band_for_score, bps, encode_leaf, keccak256, leaf_hash
from src.mst import leaf as leaf_mod
from src.mst import vectors as vec

VECTORS = json.loads(Path(vec.VECTORS_PATH).read_text(encoding="utf-8"))
ROOT = Path(__file__).resolve().parents[2]


def test_address_key_is_keccak_of_utf8():
    addr = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"
    assert address_key(addr) == keccak256(addr.encode("utf-8"))


@pytest.mark.parametrize("v", VECTORS["keyVectors"], ids=lambda v: v["address"][:12])
def test_key_vectors(v):
    assert "0x" + address_key(v["address"]).hex() == v["key"]


@pytest.mark.parametrize("v", VECTORS["bpsVectors"], ids=lambda v: str(v["value"]))
def test_bps_vectors(v):
    assert bps(v["value"]) == v["bps"]


def test_bps_rounds_half_up_and_clamps():
    assert bps(0.12345) == 1235  # 1234.5 -> up; float 0.12345*10000 would be 1234.4999..
    assert bps(0.12344) == 1234
    assert bps(0.00005) == 1
    assert bps(Decimal("0.99995")) == 10000
    assert bps(-1) == 0 and bps(7) == 10000
    with pytest.raises(ValueError):
        bps(float("nan"))


@pytest.mark.parametrize("v", VECTORS["bandVectors"], ids=lambda v: str(v["score"]))
def test_band_vectors(v):
    assert int(band_for_score(v["score"])) == v["band"]


def test_band_edges():
    assert band_for_score(None) is Band.UNSCORED
    assert band_for_score(float("nan")) is Band.UNSCORED
    assert band_for_score(0.5999) is Band.LOW
    assert band_for_score(0.6) is Band.MEDIUM
    assert band_for_score(0.7999) is Band.MEDIUM
    assert band_for_score(0.8) is Band.HIGH


def test_band_thresholds_match_dashboard_config():
    """Guard against drift: the dashboard config is the source of truth for the cut points."""
    text = (ROOT / "src" / "dashboard" / "config.py").read_text(encoding="utf-8")
    high = Decimal(re.search(r"HIGH_RISK_THRESHOLD\s*=\s*([\d.]+)", text).group(1))
    med = Decimal(re.search(r"MEDIUM_RISK_THRESHOLD\s*=\s*([\d.]+)", text).group(1))
    assert (high, med) == (leaf_mod.HIGH_RISK_THRESHOLD, leaf_mod.MEDIUM_RISK_THRESHOLD)


def test_enum_values_match_spec():
    assert [i.value for i in Intent] == [0, 1, 2, 3, 4, 5]
    assert Intent.SANCTIONS_EVASION == 3 and Intent.INSUFFICIENT_SIGNAL == 5
    assert (Flag.GEO_TEMPORAL_MISMATCH, Flag.CONTESTED_EVIDENCE, Flag.EXONERATED, Flag.KNOWN_LABEL) == (1, 2, 4, 8)
    assert [x.value for x in Band] == [0, 1, 2, 3]


@pytest.mark.parametrize("v", VECTORS["leafVectors"], ids=lambda v: v["address"][:12])
def test_leaf_vectors_and_abi_encode(v):
    f = LeafFields(
        key=bytes.fromhex(v["key"][2:]), epoch=v["epoch"], band=v["band"], risk_bps=v["riskBps"],
        haircut_bps=v["haircutBps"], cwt_bps=v["cwtBps"], lower_bps=v["lowerBps"],
        intent=v["intent"], flags=v["flags"],
    )
    enc = encode_leaf(f)
    assert "0x" + enc.hex() == v["encoded"]
    assert "0x" + leaf_hash(f).hex() == v["leaf"]
    # Independent check against a real ABI encoder.
    ref = abi_encode(
        ["bytes32", "uint32", "uint8", "uint16", "uint16", "uint16", "uint16", "uint8", "uint8"],
        [f.key, f.epoch, f.band, f.risk_bps, f.haircut_bps, f.cwt_bps, f.lower_bps, f.intent, f.flags],
    )
    assert enc == ref and len(enc) == 9 * 32


def test_leaf_range_checks():
    base = dict(key=bytes(32), epoch=1, band=1, risk_bps=0, haircut_bps=0, cwt_bps=0, lower_bps=0, intent=0, flags=0)
    encode_leaf(LeafFields(**base))
    for field, bad in [("epoch", 1 << 32), ("band", 256), ("risk_bps", 1 << 16), ("intent", -1), ("flags", 256)]:
        with pytest.raises(ValueError):
            encode_leaf(LeafFields(**{**base, field: bad}))
    with pytest.raises(ValueError):
        encode_leaf(LeafFields(**{**base, "key": bytes(31)}))
