// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/*
Stores poll metadata on L2: title, IPFS CID, options, timing, and quorum configuration.

Notes:
- Polls are created internally only via _createPoll so higher-level modules control escrow/fees.
- Exposes lightweight getters to avoid returning big dynamic arrays frequently.
- NEW: snapshot eligible voter count at creation time for reliable quorum.
*/

abstract contract Polls {
    // -----------------------------
    // Errors
    // -----------------------------
    error EmptyTitle();
    error EmptyCid();
    error BadTimeRange();
    error StartTimeInPast(uint64 startTime, uint64 nowTs);
    error TooFewOptions();
    error EmptyOption(uint256 optionIndex);
    error OptionIndexOutOfBounds(uint256 optionIndex, uint256 optionsLength);
    error InvalidPoll(uint256 pollId);
    error BadQuorumBps(uint16 quorumBps);
    error QuorumDisabledButBpsNonZero(uint16 quorumBps);
    error QuorumEnabledButBpsZero();

    // -----------------------------
    // Types
    // -----------------------------
    struct QuorumConfig {
        bool enabled;
        uint16 quorumBps; // 0..10000
    }

    struct Poll {
        uint256 id;
        uint256 groupId;
        address creator;

        string title;
        string cid;

        uint64 startTime;
        uint64 endTime;

        QuorumConfig quorum;

        /// @notice Snapshot of eligible voters count at creation time (must include owner).
        /// Snapshot of eligible voter count at poll creation.
        uint256 eligibleCountSnapshot;

        uint64 createdAt;

        string[] options;
    }

    // -----------------------------
    // Storage
    // -----------------------------
    uint256 public nextPollId;
    mapping(uint256 => Poll) internal polls;

    // -----------------------------
    // Events
    // -----------------------------
    event PollCreated(
        uint256 indexed pollId,
        uint256 indexed groupId,
        address indexed creator,
        string title,
        string cid,
        uint64 startTime,
        uint64 endTime,
        bool quorumEnabled,
        uint16 quorumBps,
        uint256 eligibleCountSnapshot
    );

    // -----------------------------
    // Hook (implemented by VeritasCore)
    // -----------------------------
    /// @dev Returns eligible voter count for poll snapshot (must include owner).
    /// Used only at creation time to store eligibleCountSnapshot.
    function _eligibleCountForPollSnapshot(uint256 groupId) internal view virtual returns (uint256);

    // -----------------------------
    // Views
    // -----------------------------
    function exists(uint256 pollId) public view returns (bool) {
        return polls[pollId].id != 0;
    }

    function getPollMeta(uint256 pollId)
        external
        view
        returns (
            uint256 id,
            uint256 groupId,
            address creator,
            string memory title,
            string memory cid,
            uint64 startTime,
            uint64 endTime,
            bool quorumEnabled,
            uint16 quorumBps,
            uint256 eligibleCountSnapshot,
            uint64 createdAt,
            uint256 optionsLength
        )
    {
        if (!exists(pollId)) revert InvalidPoll(pollId);

        Poll storage p = polls[pollId];
        return (
            p.id,
            p.groupId,
            p.creator,
            p.title,
            p.cid,
            p.startTime,
            p.endTime,
            p.quorum.enabled,
            p.quorum.quorumBps,
            p.eligibleCountSnapshot,
            p.createdAt,
            p.options.length
        );
    }

    function getPollCore(uint256 pollId)
        external
        view
        returns (
            bool exists_,
            uint256 groupId,
            uint64 startTime,
            uint64 endTime,
            uint256 eligibleCountSnapshot,
            bool quorumEnabled,
            uint16 quorumBps,
            uint256 optionsLength
        )
    {
        if (!exists(pollId)) {
            return (false, 0, 0, 0, 0, false, 0, 0);
        }

        Poll storage p = polls[pollId];

        return (
            true,
            p.groupId,
            p.startTime,
            p.endTime,
            p.eligibleCountSnapshot,
            p.quorum.enabled,
            p.quorum.quorumBps,
            p.options.length
        );
    }

    function getOptionsLength(uint256 pollId) external view returns (uint256) {
        if (!exists(pollId)) revert InvalidPoll(pollId);
        return polls[pollId].options.length;
    }

    function getOption(uint256 pollId, uint256 optionIndex) external view returns (string memory) {
        if (!exists(pollId)) revert InvalidPoll(pollId);

        Poll storage p = polls[pollId];
        if (optionIndex >= p.options.length) revert OptionIndexOutOfBounds(optionIndex, p.options.length);
        return p.options[optionIndex];
    }

    function getPoll(uint256 pollId) external view returns (Poll memory) {
        if (!exists(pollId)) revert InvalidPoll(pollId);
        return polls[pollId];
    }

    // -----------------------------
    // Internal create
    // -----------------------------
    function _createPoll(
        uint256 groupId,
        string calldata title,
        string calldata cid,
        string[] calldata options,
        uint64 startTime,
        uint64 endTime,
        bool quorumEnabled,
        uint16 quorumBps
    ) internal returns (uint256 pollId) {
        if (bytes(title).length == 0) revert EmptyTitle();
        if (bytes(cid).length == 0) revert EmptyCid();

        if (endTime <= startTime) revert BadTimeRange();

        uint64 nowTs = uint64(block.timestamp);
        if (startTime < nowTs) revert StartTimeInPast(startTime, nowTs);

        if (options.length < 2) revert TooFewOptions();
        for (uint256 i = 0; i < options.length; ) {
            if (bytes(options[i]).length == 0) revert EmptyOption(i);
            unchecked { i++; }
        }

        if (quorumBps > 10_000) revert BadQuorumBps(quorumBps);
        if (quorumEnabled) {
            if (quorumBps == 0) revert QuorumEnabledButBpsZero();
        } else {
            if (quorumBps != 0) revert QuorumDisabledButBpsNonZero(quorumBps);
        }

        // NEW: snapshot eligible count for quorum at creation time
        uint256 eligibleSnapshot = _eligibleCountForPollSnapshot(groupId);

        unchecked {
            pollId = ++nextPollId;
        }

        Poll storage p = polls[pollId];
        p.id = pollId;
        p.groupId = groupId;
        p.creator = msg.sender;

        p.title = title;
        p.cid = cid;

        p.startTime = startTime;
        p.endTime = endTime;

        p.quorum = QuorumConfig({ enabled: quorumEnabled, quorumBps: quorumBps });
        p.eligibleCountSnapshot = eligibleSnapshot;
        p.createdAt = nowTs;

        for (uint256 i = 0; i < options.length; ) {
            p.options.push(options[i]);
            unchecked { i++; }
        }

        emit PollCreated(
            pollId,
            groupId,
            msg.sender,
            title,
            cid,
            startTime,
            endTime,
            quorumEnabled,
            quorumBps,
            eligibleSnapshot
        );
    }
}
