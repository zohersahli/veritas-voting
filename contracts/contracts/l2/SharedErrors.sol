// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

/// @title SharedErrors (L2) | أخطاء مشتركة على L2
/// @notice Common custom errors shared across L2 modules (skeleton).
///         أخطاء مخصصة مشتركة بين عقود L2 (سكلتون).
/// @dev Import this file from other contracts to keep errors consistent.
///      يتم استيراد هذا الملف لتوحيد الأخطاء وتقليل التكرار.
library SharedErrors {
    // -----------------------------
    // Generic | عامة
    // -----------------------------
    error ZeroAddress();
    error Unauthorized();

    // -----------------------------
    // Groups / Membership | مجموعات / عضوية
    // -----------------------------
    error InvalidGroup(uint256 groupId);
    error NotGroupOwner(uint256 groupId);

    // -----------------------------
    // Polls | التصويتات
    // -----------------------------
    error InvalidPoll(uint256 pollId);

    // -----------------------------
    // Voting | التصويت
    // -----------------------------
    error AlreadyVoted(uint256 pollId, address voter);

    // -----------------------------
    // Finalization | الإنهاء
    // -----------------------------
    error AlreadyFinalized(uint256 pollId);
}
