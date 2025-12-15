// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;
import { SharedErrors } from "./SharedErrors.sol";
/// @title Voting (L2) | التصويت على L2
/// @notice Handles casting votes and preventing double-voting (skeleton).
///         ينفذ التصويت ويمنع التكرار (سكلتون).
/// @dev Membership + poll timing checks will be wired later.
///      التحقق من العضوية والتوقيت سيتم ربطه لاحقا.

abstract contract Voting {
    // -----------------------------
    // Errors | أخطاء
    // -----------------------------
    error BadOption(uint256 optionIndex);

    // -----------------------------
    // Storage | تخزين
    // -----------------------------
    mapping(uint256 => mapping(address => bool)) public hasVoted; // pollId => voter => bool

    // voteCounts[pollId][optionIndex] = count
    mapping(uint256 => mapping(uint256 => uint256)) public voteCounts;

    // -----------------------------
    // Events | أحداث
    // -----------------------------
    event VoteCast(uint256 indexed pollId, address indexed voter, uint256 optionIndex);

    // -----------------------------
    // Vote | تصويت
    // -----------------------------
    /// @notice Cast a vote for a poll option.
    ///         تسجيل صوت لخيار داخل Poll.
    function vote(uint256 pollId, uint256 optionIndex) external {
        if (hasVoted[pollId][msg.sender]) revert SharedErrors.AlreadyVoted(pollId, msg.sender);

        // TODO:
        // - Verify poll exists via Polls.sol
        // - Verify poll is active (startTime <= now < endTime)
        // - Verify membership via Groups.sol + Membership.sol
        // - Validate optionIndex within poll options length

        // Placeholder option check (disabled until Polls integration)
        // if (optionIndex is invalid) revert BadOption(optionIndex);

        hasVoted[pollId][msg.sender] = true;
        voteCounts[pollId][optionIndex] += 1;

        emit VoteCast(pollId, msg.sender, optionIndex);
    }
}
