// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { Groups } from "./Groups.sol";
import { Membership } from "./Membership.sol";
import { Polls } from "./Polls.sol";
import { Voting } from "./Voting.sol";
import { Delegation } from "./Delegation.sol";
import { FinalizationL2 } from "./FinalizationL2.sol";
import { CcipEscrowSenderL2 } from "./CcipEscrowSenderL2.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title VeritasCore (L2)
/// @notice Main orchestrator on L2: Groups, Membership, Polls, Voting, Delegation, Finalization, CCIP escrow sender.
/// Main L2 contract wiring all modules.
contract VeritasCore is
    Groups,
    Membership,
    Polls,
    Voting,
    Delegation,
    FinalizationL2,
    CcipEscrowSenderL2
{
    constructor(
        address router,
        address link,
        uint64 destSelector,
        address _l1Receiver,
        address _treasury,
        uint256 _receiverGasLimit
    )
    
        Ownable(msg.sender)
        CcipEscrowSenderL2(router, link, destSelector, _l1Receiver, _treasury, _receiverGasLimit)
    {}

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function createGroup(
        string calldata name,
        string calldata description,
        Groups.MembershipType membershipType
    ) public override whenNotPaused returns (uint256 groupId) {
        return super.createGroup(name, description, membershipType);
    }

    function vote(uint256 pollId, uint256 optionIndex)
    public
    override
    whenNotPaused
    {
    super.vote(pollId, optionIndex);
    }

    function delegate(uint256 pollId, address delegate_) public override whenNotPaused {
        super.delegate(pollId, delegate_);
    }

    function revoke(uint256 pollId) public override whenNotPaused {
        super.revoke(pollId);
    }

    // ============================================================
    // Hooks required by FinalizationL2
    // ============================================================
    function _pollExists(uint256 pollId) internal view override returns (bool) {
        return exists(pollId);
    }

    function _pollEndTime(uint256 pollId) internal view override returns (uint64) {
        return polls[pollId].endTime;
    }

    function _pollOptionsLength(uint256 pollId) internal view override returns (uint256) {
        return polls[pollId].options.length;
    }

    function _pollQuorum(uint256 pollId) internal view override returns (bool enabled, uint16 quorumBps) {
        Poll storage p = polls[pollId];
        return (p.quorum.enabled, p.quorum.quorumBps);
    }

    function _voteCount(uint256 pollId, uint256 optionIndex) internal view override returns (uint256) {
        return voteCounts[pollId][optionIndex];
    }

    function _finalStatusForFinalize(uint256) internal pure override returns (ResultStatus) {
        return ResultStatus.Unknown;
    }

    /// @dev Real quorum: return the snapshot stored in Polls at creation time.
    /// supported=true because snapshot exists on-chain.
    function _eligibleCountForQuorum(uint256 pollId)
        internal
        view
        override
        returns (bool supported, uint256 eligibleCount)
    {
        return (true, polls[pollId].eligibleCountSnapshot);
    }

    // ============================================================
    // Hooks required by Membership (wires Groups storage)
    // ============================================================
    function _groupExists(uint256 groupId) internal view override returns (bool) {
        return groups[groupId].owner != address(0);
    }

    function _groupOwner(uint256 groupId) internal view override returns (address) {
        return groups[groupId].owner;
    }

    function _groupMembershipType(uint256 groupId) internal view override returns (Groups.MembershipType) {
        return groups[groupId].membershipType;
    }

    // ============================================================
    // Hooks required by Polls (eligible snapshot at creation time)
    // IMPORTANT: This must match your Polls.sol hook name to avoid conflicts.
    // ============================================================
    function _eligibleCountForPollSnapshot(uint256 groupId) internal view override returns (uint256) {
        // Membership.getEligibleCountForQuorum includes owner (+1)
        return getEligibleCountForQuorum(groupId);
    }

    // ============================================================
    // Hooks required by Voting (Polls + Membership + Delegation)
    // ============================================================
    function _pollVotingData(uint256 pollId)
        internal
        view
        override
        returns (bool exists_, uint256 groupId, uint64 startTime, uint64 endTime, uint256 optionsLength)
    {
        if (!exists(pollId)) {
            return (false, 0, 0, 0, 0);
        }

        Poll storage p = polls[pollId];
        return (true, p.groupId, p.startTime, p.endTime, p.options.length);
    }

    function _isMemberForVoting(uint256 groupId, address user) internal view override returns (bool) {
        return _isMemberInternal(groupId, user);
    }

    function _delegateOfForVoting(uint256 pollId, address delegator) internal view override returns (address) {
        return delegateOf[pollId][delegator];
    }

    function _delegatedToCountForVoting(uint256 pollId, address delegate_) internal view override returns (uint256) {
        return _incomingDelegatorsCount(pollId, delegate_);
    }

    // ============================================================
    // Hooks required by Delegation (Poll-level)
    // ============================================================
    function _delegationPollData(uint256 pollId)
        internal
        view
        override
        returns (bool exists_, uint256 groupId, uint64 startTime, uint64 endTime)
    {
        if (!exists(pollId)) {
            return (false, 0, 0, 0);
        }
        Poll storage p = polls[pollId];
        return (true, p.groupId, p.startTime, p.endTime);
    }

    function _isMemberForDelegation(uint256 groupId, address user)
        internal
        view
        override
        returns (bool)
    {
        return _isMemberInternal(groupId, user);
    }

    function _hasVotedForDelegation(uint256 pollId, address user)
        internal
        view
        override
        returns (bool)
    {
        return hasVoted[pollId][user];
    }
}
