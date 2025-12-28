// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { QuorumMath } from "../libraries/QuorumMath.sol";

/// @title QuorumMathHarness
/// Exposes QuorumMath internal functions for testing.
contract QuorumMathHarness {
    function validate(uint16 bps) external pure {
        QuorumMath.validateBps(bps);
    }

    function required(uint256 total, uint16 bps) external pure returns (uint256) {
        return QuorumMath.requiredCount(total, bps);
    }

    function meets(uint256 actual, uint256 total, uint16 bps) external pure returns (bool) {
        return QuorumMath.meetsQuorum(actual, total, bps);
    }
}
