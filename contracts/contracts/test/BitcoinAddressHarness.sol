// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BitcoinAddress} from "../libraries/BitcoinAddress.sol";

/// @dev Test-only wrapper around the BitcoinAddress library.
contract BitcoinAddressHarness {
    function toHash160(string calldata addr) external pure returns (bytes20) {
        return BitcoinAddress.toHash160(addr);
    }
}
