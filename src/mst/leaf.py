"""Key derivation and leaf encoding (SHARED SPEC v1)."""

from __future__ import annotations

import math
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from enum import IntEnum, IntFlag

from .keccak import keccak256

# Risk band thresholds. The spec says "take them from the dashboard's risk.js"; no such
# file exists in this repo. These are the values src/dashboard/config.py and
# src/webapp/server.py use for the alerts view (tests/mst/test_leaf.py keeps them in sync).
HIGH_RISK_THRESHOLD = Decimal("0.80")
MEDIUM_RISK_THRESHOLD = Decimal("0.60")


class Band(IntEnum):
    UNSCORED = 0
    LOW = 1
    MEDIUM = 2
    HIGH = 3


class Intent(IntEnum):
    NONE = 0
    RANSOMWARE = 1
    DARKNET_MARKET = 2
    SANCTIONS_EVASION = 3
    PATTERN_UNCLEAR = 4
    INSUFFICIENT_SIGNAL = 5


class Flag(IntFlag):
    GEO_TEMPORAL_MISMATCH = 1 << 0
    CONTESTED_EVIDENCE = 1 << 1
    EXONERATED = 1 << 2  # alpha == 0, received-only
    KNOWN_LABEL = 1 << 3


def address_key(address: str) -> bytes:
    """key = keccak256(UTF-8 bytes of the Bitcoin address string, exactly as in the dataset)."""
    return keccak256(address.encode("utf-8"))


def _to_decimal(value) -> Decimal:
    if isinstance(value, Decimal):
        return value
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            raise ValueError(f"cannot convert {value!r} to bps")
        return Decimal(repr(value))  # shortest round-trip repr, so 0.12345 stays 0.12345
    return Decimal(value)


def bps(value) -> int:
    """round-half-up(value * 10000), clamped to 0..10000."""
    scaled = (_to_decimal(value) * 10000).quantize(Decimal(1), rounding=ROUND_HALF_UP)
    return max(0, min(10000, int(scaled)))


def band_for_score(score) -> Band:
    """UNSCORED for a missing/NaN score, else LOW / MEDIUM (>=0.60) / HIGH (>=0.80)."""
    if score is None or (isinstance(score, float) and math.isnan(score)):
        return Band.UNSCORED
    d = _to_decimal(score)
    if d >= HIGH_RISK_THRESHOLD:
        return Band.HIGH
    if d >= MEDIUM_RISK_THRESHOLD:
        return Band.MEDIUM
    return Band.LOW


@dataclass(frozen=True)
class LeafFields:
    key: bytes
    epoch: int
    band: int
    risk_bps: int
    haircut_bps: int
    cwt_bps: int
    lower_bps: int
    intent: int
    flags: int


_UINT_BITS = {
    "epoch": 32, "band": 8, "risk_bps": 16, "haircut_bps": 16,
    "cwt_bps": 16, "lower_bps": 16, "intent": 8, "flags": 8,
}


def encode_leaf(f: LeafFields) -> bytes:
    """abi.encode(bytes32,uint32,uint8,uint16,uint16,uint16,uint16,uint8,uint8): 9 x 32 bytes."""
    if len(f.key) != 32:
        raise ValueError("key must be 32 bytes")
    out = bytearray(f.key)
    for name, bits in _UINT_BITS.items():
        v = int(getattr(f, name))
        if not 0 <= v < (1 << bits):
            raise ValueError(f"{name}={v} does not fit uint{bits}")
        out += v.to_bytes(32, "big")
    return bytes(out)


def leaf_hash(f: LeafFields) -> bytes:
    return keccak256(encode_leaf(f))
