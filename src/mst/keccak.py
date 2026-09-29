"""keccak256 (the pre-NIST Ethereum variant).

Never use hashlib.sha3_256 here: that is NIST SHA3-256, which pads differently and
produces different digests.
"""

from __future__ import annotations

from eth_utils import keccak as _keccak


def keccak256(data: bytes) -> bytes:
    if not isinstance(data, (bytes, bytearray)):
        raise TypeError("keccak256 expects bytes")
    return _keccak(bytes(data))
