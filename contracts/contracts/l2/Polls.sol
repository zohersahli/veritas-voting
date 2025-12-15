// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

/// @title Polls (L2) | إدارة بيانات التصويتات على L2
/// @notice Stores poll metadata (CID, options, timing, quorum config) (skeleton).
///         يخزن بيانات الـ Poll فقط: CID والخيارات والتوقيت وإعدادات النصاب (سكلتون).
/// @dev No vote counting here. Voting.sol handles votes.
///      لا يوجد عد أصوات هنا, Voting.sol مسؤول عن الأصوات.
abstract contract Polls {
    // -----------------------------
    // Errors | أخطاء
    // -----------------------------
    error EmptyTitle();
    error EmptyCid();
    error BadTimeRange();
    error TooFewOptions();
    error InvalidPoll(uint256 pollId);

    // -----------------------------
    // Types | أنواع
    // -----------------------------
    struct QuorumConfig {
        bool enabled;
        uint16 quorumBps; // 0 - 10000 (basis points)
    }

    struct Poll {
        uint256 id;
        uint256 groupId;
        address creator;

        string title;
        string cid; // IPFS CID for description

        uint64 startTime;
        uint64 endTime;

        QuorumConfig quorum;
        uint64 createdAt;

        string[] options;
    }

    // -----------------------------
    // Storage | تخزين
    // -----------------------------
    uint256 public nextPollId;
    mapping(uint256 => Poll) internal polls;

    // -----------------------------
    // Events | أحداث
    // -----------------------------
    event PollCreated(
        uint256 indexed pollId,
        uint256 indexed groupId,
        address indexed creator,
        string title,
        string cid,
        uint64 startTime,
        uint64 endTime
    );

    // -----------------------------
    // Read | قراءة
    // -----------------------------
    function exists(uint256 pollId) external view returns (bool) {
        return polls[pollId].creator != address(0);
    }

    function getPoll(uint256 pollId) external view returns (Poll memory) {
        if (polls[pollId].creator == address(0)) revert InvalidPoll(pollId);
        return polls[pollId];
    }

    // -----------------------------
    // Create | إنشاء
    // -----------------------------
    /// @notice Create a new poll and store CID on-chain.
    ///         إنشاء Poll وتخزين CID على السلسلة.
    function createPoll(
        uint256 groupId,
        string calldata title,
        string calldata cid,
        string[] calldata options,
        uint64 startTime,
        uint64 endTime,
        bool quorumEnabled,
        uint16 quorumBps
    ) external returns (uint256 pollId) {
        if (bytes(title).length == 0) revert EmptyTitle();
        if (bytes(cid).length == 0) revert EmptyCid();
        if (endTime <= startTime) revert BadTimeRange();
        if (options.length < 2) revert TooFewOptions();

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
        p.createdAt = uint64(block.timestamp);

        // Copy options (calldata -> storage)
        for (uint256 i = 0; i < options.length; i++) {
            p.options.push(options[i]);
        }

        emit PollCreated(pollId, groupId, msg.sender, title, cid, startTime, endTime);
    }

    // TODO (English only):
    // - Validate group existence via Groups.sol
    // - Add helper views: isActive(pollId), hasEnded(pollId)
    // - Add option count limits if needed
}
