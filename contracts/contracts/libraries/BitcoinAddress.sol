// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BitcoinAddress
/// @notice Decode P2PKH (base58check) and P2WPKH (bech32, witness v0) address strings to their hash160, and
///         verify a Bitcoin signed-message ownership proof.
/// @dev Only these two address types are supported. Decoding is CANONICAL-ONLY (exact leading-'1' count for
///      base58, lowercase-only bech32): the SBT binds `key = keccak256(bytes(addressString))`, so an alternative
///      string spelling of the same hash160 would otherwise map to a different (unflagged) key.
library BitcoinAddress {
    error UnsupportedAddress();
    error BadChecksum();
    error BadSignature();
    error MessageTooLong();

    bytes internal constant B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    bytes internal constant BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

    /// @return h160 the 20-byte pubkey hash
    function toHash160(string calldata addr) internal pure returns (bytes20 h160) {
        bytes calldata a = bytes(addr);
        if (a.length >= 3 && (_isHrp(a, "bc1") || _isHrp(a, "tb1"))) return _bech32P2wpkh(a);
        return _base58P2pkh(a);
    }

    // ------------------------------------------------------------------ base58check P2PKH
    function _base58P2pkh(bytes calldata a) private pure returns (bytes20) {
        if (a.length < 26 || a.length > 35) revert UnsupportedAddress();
        uint256 n;
        uint256 leadingOnes;
        bool leading = true;
        for (uint256 i; i < a.length; ++i) {
            uint256 d = _b58Index(a[i]);
            if (leading && d == 0) ++leadingOnes;
            else leading = false;
            n = n * 58 + d;
        }
        if (n >> 200 != 0) revert UnsupportedAddress(); // payload is exactly 25 bytes
        uint8 version = uint8(n >> 192);
        if (version != 0x00 && version != 0x6f) revert UnsupportedAddress(); // P2PKH mainnet / testnet only
        // canonical: leading '1' count equals number of leading zero bytes in the 25-byte payload
        uint256 zeros;
        for (uint256 i = 25; i > 0; --i) {
            if (uint8(n >> ((i - 1) * 8)) == 0) ++zeros;
            else break;
        }
        if (zeros != leadingOnes) revert UnsupportedAddress();
        bytes20 h = bytes20(uint160(n >> 32));
        bytes32 c = sha256(abi.encodePacked(sha256(abi.encodePacked(version, h))));
        if (bytes4(c) != bytes4(uint32(n))) revert BadChecksum();
        return h;
    }

    function _b58Index(bytes1 c) private pure returns (uint256) {
        bytes memory alphabet = B58;
        for (uint256 i; i < 58; ++i) {
            if (alphabet[i] == c) return i;
        }
        revert UnsupportedAddress();
    }

    // ------------------------------------------------------------------ bech32 P2WPKH (v0)
    function _isHrp(bytes calldata a, bytes3 p) private pure returns (bool) {
        return a.length >= 3 && bytes3(a[0:3]) == p;
    }

    function _bech32P2wpkh(bytes calldata a) private pure returns (bytes20) {
        // "bc1"/"tb1" + witness version 'q' (0) + 32 program chars + 6 checksum chars = 42
        if (a.length != 42 || a[3] != "q") revert UnsupportedAddress();
        bytes memory charset = BECH32;
        uint8[] memory data = new uint8[](39);
        for (uint256 i; i < 39; ++i) {
            bytes1 c = a[3 + i];
            uint256 idx = 32;
            for (uint256 j; j < 32; ++j) {
                if (charset[j] == c) {
                    idx = j;
                    break;
                }
            }
            if (idx == 32) revert UnsupportedAddress(); // also rejects uppercase
            data[i] = uint8(idx);
        }
        // checksum over expanded hrp ("bc" or "tb") + data
        uint256 chk = 1;
        chk = _polymod(chk, uint8(a[0]) >> 5);
        chk = _polymod(chk, uint8(a[1]) >> 5);
        chk = _polymod(chk, 0);
        chk = _polymod(chk, uint8(a[0]) & 31);
        chk = _polymod(chk, uint8(a[1]) & 31);
        for (uint256 i; i < 39; ++i) chk = _polymod(chk, data[i]);
        if (chk != 1) revert BadChecksum();

        // 32 five-bit groups (data[1..32]) -> 160 bits
        uint256 acc;
        for (uint256 i = 1; i <= 32; ++i) acc = (acc << 5) | data[i];
        return bytes20(uint160(acc));
    }

    function _polymod(uint256 chk, uint256 v) private pure returns (uint256) {
        uint256 b = chk >> 25;
        chk = ((chk & 0x1ffffff) << 5) ^ v;
        if (b & 1 != 0) chk ^= 0x3b6a57b2;
        if (b & 2 != 0) chk ^= 0x26508e6d;
        if (b & 4 != 0) chk ^= 0x1ea119fa;
        if (b & 8 != 0) chk ^= 0x3d4233dd;
        if (b & 16 != 0) chk ^= 0x2a1462b3;
        return chk;
    }

    // ------------------------------------------------------------------ signed-message ownership
    /// @notice True iff (r, s, v) is a signature over Bitcoin's signed-message digest of `message`, made by the
    ///         key whose uncompressed public key is (pubX, pubY), and hash160(compressed pubkey) == `h160`.
    /// @dev `ecrecover` yields an Ethereum-style address, not a public key. So the pubkey is supplied by the
    ///      caller and bound to the signature by checking keccak256(pubX||pubY)[12:] == ecrecover(...).
    ///      Only compressed-pubkey addresses (the modern P2PKH / all P2WPKH) can be proven.
    function verifyOwnership(bytes20 h160, bytes memory message, bytes32 pubX, bytes32 pubY, uint8 v, bytes32 r, bytes32 s)
        internal
        pure
        returns (bool)
    {
        if (v != 27 && v != 28) return false;
        if (message.length >= 253) revert MessageTooLong();
        bytes32 digest = sha256(
            abi.encodePacked(sha256(abi.encodePacked(bytes("\x18Bitcoin Signed Message:\n"), uint8(message.length), message)))
        );
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) return false;
        if (address(uint160(uint256(keccak256(abi.encodePacked(pubX, pubY))))) != signer) return false;
        bytes1 prefix = uint256(pubY) & 1 == 0 ? bytes1(0x02) : bytes1(0x03);
        bytes20 derived = ripemd160(abi.encodePacked(sha256(abi.encodePacked(prefix, pubX))));
        return derived == h160;
    }
}
