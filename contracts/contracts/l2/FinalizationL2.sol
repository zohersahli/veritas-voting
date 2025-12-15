// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;
import { QuorumMath } from "../libraries/QuorumMath.sol";

/// @title FinalizationL2 (L2) | إنهاء التصويت على L2
/// @notice Finalizes a poll after it ends and emits an event for the off-chain finalizer (skeleton).
///         ينهي الـ Poll بعد انتهائه ويطلق حدث للبوت الخارجي (سكلتون).
/// @dev Actual result calculation will be implemented later using Polls + Voting + QuorumMath.
///      حساب النتيجة الحقيقي سيتم لاحقا عبر Polls و Voting و QuorumMath.
abstract contract FinalizationL2 {
    // -----------------------------
    // Errors | أخطاء
    // -----------------------------
    error AlreadyFinalized(uint256 pollId);

    // -----------------------------
    // Types | أنواع
    // -----------------------------
    enum ResultStatus {
        Unknown,
        Passed,
        FailedQuorum
        // TODO: add more statuses later if needed (e.g., Tied, Rejected)
    }

    struct FinalizedResult {
        bool finalized;
        ResultStatus status;
        uint256 winningOption; // placeholder (for multi-choice)
        uint256 totalVotes;    // placeholder
    }

    // -----------------------------
    // Storage | تخزين
    // -----------------------------
    mapping(uint256 => FinalizedResult) public results; // pollId => finalized data

    // -----------------------------
    // Events | أحداث
    // -----------------------------
    event PollFinalized(
        uint256 indexed pollId,
        ResultStatus status,
        uint256 winningOption,
        uint256 totalVotes
    );

    // -----------------------------
    // Finalize | إنهاء
    // -----------------------------
    /// @notice Finalize poll on L2 and emit event for bot.
    ///         إنهاء الـ Poll على L2 وإطلاق الحدث للبوت.
    function finalizePollOnL2(uint256 pollId) external {
        if (results[pollId].finalized) revert AlreadyFinalized(pollId);

        // TODO:
        // - Verify poll exists and has ended (Polls.sol)
        // - Compute totalVotes and winningOption (Voting.sol)
        // - Compute quorum pass/fail (QuorumMath + Polls quorum config)
        // - Set status accordingly

        // Skeleton placeholders
        results[pollId] = FinalizedResult({
            finalized: true,
            status: ResultStatus.Unknown,
            winningOption: 0,
            totalVotes: 0
        });

        emit PollFinalized(pollId, results[pollId].status, 0, 0);
    }
}
