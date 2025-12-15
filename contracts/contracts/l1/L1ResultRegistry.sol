// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

/// @title L1ResultRegistry (L1) | سجل النتائج النهائي على L1
/// @notice Records finalized poll results once (immutable) (skeleton).
///         يسجل نتائج التصويت النهائية مرة واحدة فقط وبشكل غير قابل للتعديل (سكلتون).
/// @dev This registry does not calculate results. It only stores a committed result.
///      هذا العقد لا يحسب النتائج, فقط يخزن النتيجة المرسلة إليه.
contract L1ResultRegistry {
    // -----------------------------
    // Errors | أخطاء
    // -----------------------------
    error AlreadyRecorded(uint256 pollId);

    // -----------------------------
    // Storage | تخزين
    // -----------------------------
    // pollId => recorded
    mapping(uint256 => bool) public recorded;

    // pollId => resultHash (packed/hashed result data)
    mapping(uint256 => bytes32) public resultHashOf;

    // -----------------------------
    // Events | أحداث
    // -----------------------------
    event ResultRecorded(uint256 indexed pollId, bytes32 resultHash);

    // -----------------------------
    // Record | تسجيل
    // -----------------------------
    /// @notice Record final result for a poll once.
    ///         تسجيل النتيجة النهائية مرة واحدة فقط.
    function recordResult(uint256 pollId, bytes32 resultHash) external {
        if (recorded[pollId]) revert AlreadyRecorded(pollId);

        recorded[pollId] = true;
        resultHashOf[pollId] = resultHash;

        emit ResultRecorded(pollId, resultHash);
    }

    // TODO:
    // - Decide who is allowed to call recordResult (Escrow contract? bot? anyone?)
    // - Consider storing more fields later (e.g., status, winningOption, totalVotes)
}
