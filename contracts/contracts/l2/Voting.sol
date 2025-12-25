// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { SharedErrors } from "./SharedErrors.sol";

/// @title Voting (L2)
/// @notice Cast votes with full checks: poll exists, timing, option bounds, membership, and delegation.
/// EN: Voting with delegation support (weighted votes).
/// AR: التصويت مع دعم التفويض (تصويت بوزن).
abstract contract Voting {
    // -----------------------------
    // Errors
    // -----------------------------
    error VotingPollDoesNotExist(uint256 pollId);
    error VotingPollNotStarted(uint256 pollId, uint64 startTime, uint64 nowTs);
    error VotingPollEnded(uint256 pollId, uint64 endTime, uint64 nowTs);
    error VotingBadOption(uint256 optionIndex);
    error VotingNotMember(uint256 groupId, address user);
    error VotingDelegated(uint256 pollId, address delegator, address delegate);

    // -----------------------------
    // Storage
    // -----------------------------
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 => mapping(uint256 => uint256)) public voteCounts;

    // -----------------------------
    // Events
    // -----------------------------
    event VoteCast(uint256 indexed pollId, address indexed voter, uint256 optionIndex);
    event VoteCastWeighted(uint256 indexed pollId, address indexed voter, uint256 optionIndex, uint256 weight);

    // -----------------------------
    // Hooks (wired by VeritasCore)
    // -----------------------------
    function _pollVotingData(uint256 pollId)
        internal
        view
        virtual
        returns (bool exists_, uint256 groupId, uint64 startTime, uint64 endTime, uint256 optionsLength);

    function _isMemberForVoting(uint256 groupId, address user) internal view virtual returns (bool);

    function _delegateOfForVoting(uint256 pollId, address delegator) internal view virtual returns (address);

    function _delegatedToCountForVoting(uint256 pollId, address delegate) internal view virtual returns (uint256);

    // -----------------------------
    // Vote
    // -----------------------------
    function vote(uint256 pollId, uint256 optionIndex) public virtual {
        if (hasVoted[pollId][msg.sender]) {
            revert SharedErrors.AlreadyVoted(pollId, msg.sender);
        }

        (bool exists_, uint256 groupId, uint64 startTime, uint64 endTime, uint256 optionsLength) =
            _pollVotingData(pollId);

        if (!exists_) revert VotingPollDoesNotExist(pollId);

        uint64 nowTs = uint64(block.timestamp);
        if (nowTs < startTime) revert VotingPollNotStarted(pollId, startTime, nowTs);
        if (nowTs >= endTime) revert VotingPollEnded(pollId, endTime, nowTs);

        if (optionIndex >= optionsLength) revert VotingBadOption(optionIndex);

        if (!_isMemberForVoting(groupId, msg.sender)) revert VotingNotMember(groupId, msg.sender);

        address delegate_ = _delegateOfForVoting(pollId, msg.sender);
        if (delegate_ != address(0)) {
            revert VotingDelegated(pollId, msg.sender, delegate_);
        }

        uint256 delegatedToCount = _delegatedToCountForVoting(pollId, msg.sender);
        uint256 weight = 1 + delegatedToCount;

        hasVoted[pollId][msg.sender] = true;

        unchecked {
            voteCounts[pollId][optionIndex] += weight;
        }

        emit VoteCast(pollId, msg.sender, optionIndex);
        emit VoteCastWeighted(pollId, msg.sender, optionIndex, weight);
    }
}
