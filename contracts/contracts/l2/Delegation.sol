// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;


/// @title Delegation (L2)
/// @notice Poll-level delegation: each delegator can delegate to one delegate per poll.
abstract contract Delegation {
    // -----------------------------
    // Errors
    // -----------------------------
    error DelegationSelfNotAllowed(address account);
    error DelegationZeroAddress();

    error DelegationPollDoesNotExist(uint256 pollId);
    error DelegationPollNotStarted(uint256 pollId, uint64 startTime, uint64 nowTs);
    error DelegationPollEnded(uint256 pollId, uint64 endTime, uint64 nowTs);

    error DelegationNotMember(uint256 groupId, address user);

    error DelegationDelegatorAlreadyVoted(uint256 pollId, address delegator);
    error DelegationDelegateAlreadyVoted(uint256 pollId, address delegate);

    error DelegationDelegateHasDelegated(uint256 pollId, address delegate);
    error DelegationDelegatorHasIncoming(uint256 pollId, address delegator);

    error DelegationNotDelegating(uint256 pollId, address delegator);
    error DelegationLockedAfterDelegateVoted(uint256 pollId, address delegator, address delegate);
    error DelegationNoChange(uint256 pollId, address delegator, address delegate);

    error DelegationIndexOutOfBounds(uint256 index, uint256 length);

    // -----------------------------
    // Storage
    // -----------------------------
    mapping(uint256 => mapping(address => address)) public delegateOf;
    mapping(uint256 => mapping(address => address[])) private _delegatorsTo;
    mapping(uint256 => mapping(address => uint256)) private _delegatorPosPlusOne;

    // -----------------------------
    // Events
    // -----------------------------
    event Delegated(uint256 indexed pollId, uint256 indexed groupId, address indexed delegator, address delegate);
    event DelegationRevoked(uint256 indexed pollId, uint256 indexed groupId, address indexed delegator);

    // -----------------------------
    // Hooks (wired by VeritasCore)
    // -----------------------------
    function _delegationPollData(uint256 pollId)
        internal
        view
        virtual
        returns (bool exists_, uint256 groupId, uint64 startTime, uint64 endTime);

    function _isMemberForDelegation(uint256 groupId, address user) internal view virtual returns (bool);

    function _hasVotedForDelegation(uint256 pollId, address user) internal view virtual returns (bool);

    // -----------------------------
    // Views (UI helpers)
    // -----------------------------
    function delegatedToCount(uint256 pollId, address delegate_) external view returns (uint256) {
        return _delegatorsTo[pollId][delegate_].length;
    }

    function delegatorAt(uint256 pollId, address delegate_, uint256 index) external view returns (address) {
        address[] storage arr = _delegatorsTo[pollId][delegate_];
        if (index >= arr.length) revert DelegationIndexOutOfBounds(index, arr.length);
        return arr[index];
    }

    function delegatorsSlice(
        uint256 pollId,
        address delegate_,
        uint256 offset,
        uint256 limit
    ) external view returns (address[] memory out) {
        address[] storage arr = _delegatorsTo[pollId][delegate_];
        uint256 n = arr.length;

        if (offset >= n) return new address[](0);

        uint256 end = offset + limit;
        if (end > n) end = n;

        out = new address[](end - offset);
        for (uint256 i = offset; i < end; ) {
            out[i - offset] = arr[i];
            unchecked { i++; }
        }
    }

    function _incomingDelegatorsCount(uint256 pollId, address delegate_) internal view returns (uint256) {
        return _delegatorsTo[pollId][delegate_].length;
    }

    // -----------------------------
    // Actions
    // -----------------------------
    function delegate(uint256 pollId, address delegate_) public virtual {
        if (delegate_ == address(0)) revert DelegationZeroAddress();
        if (delegate_ == msg.sender) revert DelegationSelfNotAllowed(msg.sender);

        (bool exists_, uint256 groupId, uint64 startTime, uint64 endTime) = _delegationPollData(pollId);
        if (!exists_) revert DelegationPollDoesNotExist(pollId);

        uint64 nowTs = uint64(block.timestamp);
        if (nowTs < startTime) revert DelegationPollNotStarted(pollId, startTime, nowTs);
        if (nowTs >= endTime) revert DelegationPollEnded(pollId, endTime, nowTs);

        if (!_isMemberForDelegation(groupId, msg.sender)) revert DelegationNotMember(groupId, msg.sender);
        if (!_isMemberForDelegation(groupId, delegate_)) revert DelegationNotMember(groupId, delegate_);

        if (_hasVotedForDelegation(pollId, msg.sender)) {
            revert DelegationDelegatorAlreadyVoted(pollId, msg.sender);
        }

        if (_hasVotedForDelegation(pollId, delegate_)) {
            revert DelegationDelegateAlreadyVoted(pollId, delegate_);
        }

        if (delegateOf[pollId][delegate_] != address(0)) {
            revert DelegationDelegateHasDelegated(pollId, delegate_);
        }

        if (_delegatorsTo[pollId][msg.sender].length > 0) {
            revert DelegationDelegatorHasIncoming(pollId, msg.sender);
        }

        address old = delegateOf[pollId][msg.sender];
        if (old == delegate_) revert DelegationNoChange(pollId, msg.sender, delegate_);

        if (old != address(0)) {
            if (_hasVotedForDelegation(pollId, old)) {
                revert DelegationLockedAfterDelegateVoted(pollId, msg.sender, old);
            }
            _removeIncoming(pollId, old, msg.sender);
        }

        delegateOf[pollId][msg.sender] = delegate_;
        _addIncoming(pollId, delegate_, msg.sender);

        emit Delegated(pollId, groupId, msg.sender, delegate_);
    }

    function revoke(uint256 pollId) public virtual {
        (bool exists_, uint256 groupId, uint64 startTime, uint64 endTime) = _delegationPollData(pollId);
        if (!exists_) revert DelegationPollDoesNotExist(pollId);

        uint64 nowTs = uint64(block.timestamp);
        if (nowTs < startTime) revert DelegationPollNotStarted(pollId, startTime, nowTs);
        if (nowTs >= endTime) revert DelegationPollEnded(pollId, endTime, nowTs);

        address d = delegateOf[pollId][msg.sender];
        if (d == address(0)) revert DelegationNotDelegating(pollId, msg.sender);

        if (_hasVotedForDelegation(pollId, msg.sender)) {
            revert DelegationDelegatorAlreadyVoted(pollId, msg.sender);
        }

        if (_hasVotedForDelegation(pollId, d)) {
            revert DelegationLockedAfterDelegateVoted(pollId, msg.sender, d);
        }

        _removeIncoming(pollId, d, msg.sender);
        delete delegateOf[pollId][msg.sender];

        emit DelegationRevoked(pollId, groupId, msg.sender);
    }

    // -----------------------------
    // Internal helpers
    // -----------------------------
    function _addIncoming(uint256 pollId, address delegate_, address delegator) internal {
        _delegatorsTo[pollId][delegate_].push(delegator);
        _delegatorPosPlusOne[pollId][delegator] = _delegatorsTo[pollId][delegate_].length;
    }

    function _removeIncoming(uint256 pollId, address delegate_, address delegator) internal {
        uint256 posPlusOne = _delegatorPosPlusOne[pollId][delegator];
        if (posPlusOne == 0) return;

        address[] storage arr = _delegatorsTo[pollId][delegate_];
        uint256 idx = posPlusOne - 1;
        uint256 last = arr.length - 1;

        if (idx != last) {
            address moved = arr[last];
            arr[idx] = moved;
            _delegatorPosPlusOne[pollId][moved] = idx + 1;
        }

        arr.pop();
        _delegatorPosPlusOne[pollId][delegator] = 0;
    }
}
