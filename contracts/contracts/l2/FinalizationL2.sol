// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title FinalizationL2
/// @notice Finalizes polls on L2 by computing total votes and winner, then determines final status.
/// EN: Computes result (winner + totals) and stores an immutable finalized record on L2.
/// AR: يحسب النتيجة (الفائز + مجموع الأصوات) ثم يحدد الحالة النهائية ويخزنها نهائيا على L2.
abstract contract FinalizationL2 {
    // -----------------------------
    // Errors (prefixed to avoid clashes)
    // -----------------------------
    error FinalizationAlreadyFinalized(uint256 pollId);
    error FinalizationPollDoesNotExist(uint256 pollId);
    error FinalizationPollNotEnded(uint256 pollId, uint64 endTime, uint64 nowTs);
    error FinalizationInvalidFinalStatus(uint256 pollId);
    error FinalizationZeroOptions(uint256 pollId);

    // EN: Defensive error in case of unrealistic overflow in quorum math.
    // AR: خطأ دفاعي في حالة overflow غير واقعية في حساب النصاب.
    error FinalizationQuorumOverflow(uint256 pollId);

    // -----------------------------
    // Types
    // -----------------------------
    enum ResultStatus {
        Unknown,
        Passed,
        FailedQuorum
    }

    struct FinalizedResult {
        bool finalized;
        ResultStatus status;
        uint256 winningOption;
        uint256 totalVotes;
    }

    // -----------------------------
    // Storage
    // -----------------------------
    mapping(uint256 => FinalizedResult) public results;

    // -----------------------------
    // Events
    // -----------------------------
    event PollFinalized(
        uint256 indexed pollId,
        ResultStatus status,
        uint256 winningOption,
        uint256 totalVotes
    );

    // -----------------------------
    // Hooks (implemented by VeritasCore)
    // -----------------------------
    function _pollExists(uint256 pollId) internal view virtual returns (bool);
    function _pollEndTime(uint256 pollId) internal view virtual returns (uint64);
    function _pollOptionsLength(uint256 pollId) internal view virtual returns (uint256);
    function _pollQuorum(uint256 pollId) internal view virtual returns (bool enabled, uint16 quorumBps);
    function _voteCount(uint256 pollId, uint256 optionIndex) internal view virtual returns (uint256);

    /// @dev Local-testing hook to force status.
    /// EN: If returns Passed or FailedQuorum, it overrides computed status (tests only).
    /// EN: If returns Unknown, status is computed from votes + quorum logic.
    /// AR: Hook للاختبار. إذا Unknown نحسب النتيجة فعليا.
    function _finalStatusForFinalize(uint256 pollId) internal view virtual returns (ResultStatus);

    // -----------------------------
    // Optional quorum hook (real quorum uses snapshot from Polls)
    // -----------------------------
    /// @dev Return eligible voter count for quorum math (by pollId).
    /// EN: VeritasCore should override and return Poll.eligibleCountSnapshot.
    /// AR: VeritasCore يعمل override ويرجع eligibleCountSnapshot.
    function _eligibleCountForQuorum(uint256)
        internal
        view
        virtual
        returns (bool supported, uint256 eligibleCount)
    {
        return (false, 0);
    }

    // -----------------------------
    // Internal quorum helpers
    // -----------------------------
    /// @dev required = ceil(eligibleCount * qBps / 10000)
    function _requiredVotesCeil(uint256 pollId, uint256 eligibleCount, uint16 qBps) internal pure returns (uint256) {
        uint256 bps = uint256(qBps);
        if (eligibleCount == 0 || bps == 0) return 0;

        if (eligibleCount > type(uint256).max / bps) revert FinalizationQuorumOverflow(pollId);
        uint256 prod = eligibleCount * bps;

        return (prod + 9_999) / 10_000;
    }

    // -----------------------------
    // Finalize
    // -----------------------------
    function finalizePollOnL2(uint256 pollId) external {
        // 1) Guards
        if (results[pollId].finalized) revert FinalizationAlreadyFinalized(pollId);
        if (!_pollExists(pollId)) revert FinalizationPollDoesNotExist(pollId);

        uint64 endTime = _pollEndTime(pollId);
        uint64 nowTs = uint64(block.timestamp);
        if (nowTs < endTime) revert FinalizationPollNotEnded(pollId, endTime, nowTs);

        uint256 optionsLength = _pollOptionsLength(pollId);
        if (optionsLength == 0) revert FinalizationZeroOptions(pollId);

        // 2) Compute totals + winner
        uint256 totalVotes = 0;
        uint256 winningOption = 0;
        uint256 winningVotes = 0;

        for (uint256 i = 0; i < optionsLength; ) {
            uint256 c = _voteCount(pollId, i);
            totalVotes += c;

            // EN: tie-break is deterministic: only update on strictly greater
            // AR: كسر التعادل ثابت: التحديث فقط عند أكبر
            if (c > winningVotes) {
                winningVotes = c;
                winningOption = i;
            }

            unchecked { i++; }
        }

        // 3) Read quorum config
        (bool qEnabled, uint16 qBps) = _pollQuorum(pollId);

        // 4) Compute status from votes + quorum
        ResultStatus computed;

        // EN: baseline: no participation => FailedQuorum
        // AR: قاعدة أساسية: 0 أصوات => FailedQuorum
        if (totalVotes == 0) {
            computed = ResultStatus.FailedQuorum;
        } else {
            computed = ResultStatus.Passed;
        }

        // EN: if quorum enabled and eligibleCount is available, apply real quorum math
        // AR: إذا النصاب مفعل و eligibleCount متوفر نطبق النصاب الحقيقي
        if (qEnabled) {
            (bool supported, uint256 eligibleCount) = _eligibleCountForQuorum(pollId);

            if (supported && eligibleCount > 0 && qBps > 0) {
                uint256 requiredVotes = _requiredVotesCeil(pollId, eligibleCount, qBps);
                if (requiredVotes > 0 && totalVotes < requiredVotes) {
                    computed = ResultStatus.FailedQuorum;
                }
            }
        }

        // 5) Forced status (tests/dev)
        ResultStatus forced = _finalStatusForFinalize(pollId);

        if (
            forced != ResultStatus.Unknown &&
            forced != ResultStatus.Passed &&
            forced != ResultStatus.FailedQuorum
        ) {
            revert FinalizationInvalidFinalStatus(pollId);
        }

        ResultStatus st;
        if (forced == ResultStatus.Unknown) {
            st = computed;
        } else {
            st = forced;

            // EN: safety: never allow Passed with 0 votes
            // AR: أمان: لا نسمح Passed مع 0 أصوات
            if (st == ResultStatus.Passed && totalVotes == 0) {
                st = ResultStatus.FailedQuorum;
            }
        }

        // 6) Persist result
        results[pollId] = FinalizedResult({
            finalized: true,
            status: st,
            winningOption: winningOption,
            totalVotes: totalVotes
        });

        emit PollFinalized(pollId, st, winningOption, totalVotes);
    }
}
