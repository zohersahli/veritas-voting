// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title SharedErrors (L2)
/// @notice Common custom errors shared across L2 modules (skeleton).
/// @dev Import this file from other contracts to keep errors consistent.
library SharedErrors {
    // -----------------------------
    // Generic
    // -----------------------------
    error ZeroAddress();
    error Unauthorized();

    // -----------------------------
    // Groups / Membership
    // -----------------------------
    error InvalidGroup(uint256 groupId);
    error NotGroupOwner(uint256 groupId);

    // -----------------------------
    // Polls
    // -----------------------------
    error InvalidPoll(uint256 pollId);

    // -----------------------------
    // Voting
    // -----------------------------
    error AlreadyVoted(uint256 pollId, address voter);

    // -----------------------------
    // Finalization
    // -----------------------------
    error AlreadyFinalized(uint256 pollId);
}
