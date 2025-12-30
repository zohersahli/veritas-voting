// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title QuorumMath
/// @notice Basis points (BPS) helpers for quorum calculations (skeleton).
/// @dev BPS range: 0..10000 where 10000 = 100%.
library QuorumMath {
    // -----------------------------
    // Errors
    // -----------------------------
    error BadBps(uint16 bps);

    // -----------------------------
    // Constants
    // -----------------------------
    uint16 internal constant MAX_BPS = 10_000;

    /// @notice Validates BPS value.
    function validateBps(uint16 bps) internal pure {
        if (bps > MAX_BPS) revert BadBps(bps);
    }

    /// @notice Returns required count to satisfy quorum:
    ///         ceil(total * bps / 10000).
    function requiredCount(uint256 total, uint16 bps) internal pure returns (uint256) {
        validateBps(bps);
        if (total == 0 || bps == 0) return 0;

        // ceil(total * bps / MAX_BPS)
        uint256 numerator = total * uint256(bps);
        return (numerator + (MAX_BPS - 1)) / MAX_BPS;
    }

    /// @notice Returns true if actual meets quorum:
    ///         actual >= ceil(total * bps / 10000).
    function meetsQuorum(uint256 actual, uint256 total, uint16 bps) internal pure returns (bool) {
        return actual >= requiredCount(total, bps);
    }
}
