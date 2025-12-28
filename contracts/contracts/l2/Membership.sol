// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { Groups } from "./Groups.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @title Membership (L2)
/// @notice Membership checks and management for groups: Manual, NFT, ClaimCode.
/// @dev Uses hooks so VeritasCore wires Groups storage without tight coupling.
/// Membership management for groups: Manual, NFT (register + hold), ClaimCode.
abstract contract Membership {
    // -----------------------------
    // Errors
    // -----------------------------
    error GroupDoesNotExist(uint256 groupId);
    error NotGroupOwner(uint256 groupId);
    error UnsupportedMembershipType(uint8 membershipType);
    error MembershipTypeMismatch(uint8 expected, uint8 got);

    error ZeroAddress();
    error ZeroCodeHash();
    error ClaimCodeAlreadyExists(bytes32 codeHash);
    error ClaimCodeNotFound(bytes32 codeHash);
    error ClaimCodeAlreadyUsed(bytes32 codeHash);
    error ClaimCodeWrongGroup(bytes32 codeHash, uint256 expectedGroupId, uint256 gotGroupId);

    // Member counting and registration
    error OwnerMembershipImmutable(uint256 groupId, address owner);

    // NFT register flow
    error NftNotSet(uint256 groupId);
    error NftBalanceRequired(uint256 groupId, address user);
    error NftAlreadyRegistered(uint256 groupId, address user);
    error NftNotRegistered(uint256 groupId, address user);

    // -----------------------------
    // Storage
    // -----------------------------
    /// @notice Manual membership: groupId -> user -> isMember
    /// Manual membership controlled by group owner.
    mapping(uint256 => mapping(address => bool)) public manualMembers;

    /// @notice NFT membership: groupId -> NFT contract address
    /// NFT contract used for membership in this group (NFT mode only).
    mapping(uint256 => address) public groupNft;

    /// @notice NFT registration: groupId -> user -> registered
    /// @dev In NFT mode, membership requires (registered == true) AND (balanceOf(user) > 0)
    /// Register inside group + still hold the NFT at vote time.
    mapping(uint256 => mapping(address => bool)) public nftRegistered;

    /// @notice Claim codes: codeHash -> groupId (0 means not created)
    /// Bind codeHash to a group to prevent cross-group usage.
    mapping(bytes32 => uint256) public claimCodeGroup;

    /// @notice Claim codes: used flag
    mapping(bytes32 => bool) public claimCodeUsed;

    /// @notice Claim codes: who claimed (optional)
    mapping(bytes32 => address) public claimCodeOwner;

    /// @notice Group member count excluding owner
    /// We exclude owner from stored count, and add +1 in eligibleCount.
    mapping(uint256 => uint256) internal _groupMemberCount;

    // -----------------------------
    // Events
    // -----------------------------
    event ManualMemberSet(uint256 indexed groupId, address indexed member, bool isMember);
    event GroupNftSet(uint256 indexed groupId, address indexed nft);
    event ClaimCodeCreated(uint256 indexed groupId, bytes32 indexed codeHash);
    event ClaimCodeClaimed(uint256 indexed groupId, bytes32 indexed codeHash, address indexed member);

    event NftMemberRegistered(uint256 indexed groupId, address indexed member);
    event NftMemberUnregistered(uint256 indexed groupId, address indexed member);

    event GroupMemberCountChanged(uint256 indexed groupId, uint256 newCount);

    // -----------------------------
    // Hooks (wired by VeritasCore)
    // -----------------------------
    function _groupExists(uint256 groupId) internal view virtual returns (bool);
    function _groupOwner(uint256 groupId) internal view virtual returns (address);
    function _groupMembershipType(uint256 groupId) internal view virtual returns (Groups.MembershipType);

    // -----------------------------
    // Modifiers
    // -----------------------------
    modifier onlyExistingGroup(uint256 groupId) {
        if (!_groupExists(groupId)) revert GroupDoesNotExist(groupId);
        _;
    }

    modifier onlyGroupOwner(uint256 groupId) {
        if (!_groupExists(groupId)) revert GroupDoesNotExist(groupId);
        if (_groupOwner(groupId) != msg.sender) revert NotGroupOwner(groupId);
        _;
    }

    // -----------------------------
    // Public views (counts)
    // -----------------------------
    /// @notice Returns current stored member count excluding owner.
    /// Raw stored count (owner excluded).
    function getGroupMemberCount(uint256 groupId) public view onlyExistingGroup(groupId) returns (uint256) {
        return _groupMemberCount[groupId];
    }

    /// @notice Returns eligible count including owner (recommended for quorum snapshots).
    /// eligible = stored count + 1 (owner).
    function getEligibleCountForQuorum(uint256 groupId) public view onlyExistingGroup(groupId) returns (uint256) {
        return _groupMemberCount[groupId] + 1;
    }

    // -----------------------------
    // Membership checks
    // -----------------------------
    /// @notice Returns true if user is a member according to the group's membership type.
    /// Owner is always a member.
    function isMember(uint256 groupId, address user) public view onlyExistingGroup(groupId) returns (bool) {
        address owner = _groupOwner(groupId);
        if (user == owner) return true;

        Groups.MembershipType t = _groupMembershipType(groupId);

        if (t == Groups.MembershipType.Manual) {
            return manualMembers[groupId][user];
        }

        if (t == Groups.MembershipType.NFT) {
            address nft = groupNft[groupId];
            if (nft == address(0)) return false;

            // Must be registered AND still hold NFT at check time (vote time).
            if (!nftRegistered[groupId][user]) return false;
            return IERC721(nft).balanceOf(user) > 0;
        }

        if (t == Groups.MembershipType.ClaimCode) {
            // In ClaimCode mode, claimed members are stored in manualMembers.
            return manualMembers[groupId][user];
        }

        revert UnsupportedMembershipType(uint8(t));
    }

    /// @notice Strict check: validates provided membershipType matches the group's actual type.
    function isMember(
        uint256 groupId,
        address user,
        Groups.MembershipType membershipType
    ) external view onlyExistingGroup(groupId) returns (bool) {
        Groups.MembershipType actual = _groupMembershipType(groupId);
        if (actual != membershipType) revert MembershipTypeMismatch(uint8(actual), uint8(membershipType));
        return isMember(groupId, user);
    }

    // -----------------------------
    // Manual membership (Manual + ClaimCode)
    // -----------------------------
    /// @notice Add or remove a member manually.
    /// Allowed in Manual and ClaimCode, not allowed in NFT mode.
    function setManualMember(uint256 groupId, address member, bool isMember_)
        external
        onlyGroupOwner(groupId)
    {
        if (member == address(0)) revert ZeroAddress();

        address owner = _groupOwner(groupId);
        if (member == owner) revert OwnerMembershipImmutable(groupId, owner);

        Groups.MembershipType t = _groupMembershipType(groupId);
        if (t == Groups.MembershipType.NFT) revert UnsupportedMembershipType(uint8(t));

        bool was = manualMembers[groupId][member];
        if (was == isMember_) {
            emit ManualMemberSet(groupId, member, isMember_);
            return;
        }

        manualMembers[groupId][member] = isMember_;

        // Update count only on real state change
        if (!was && isMember_) {
            _groupMemberCount[groupId] += 1;
            emit GroupMemberCountChanged(groupId, _groupMemberCount[groupId]);
        } else if (was && !isMember_) {
            _groupMemberCount[groupId] -= 1;
            emit GroupMemberCountChanged(groupId, _groupMemberCount[groupId]);
        }

        emit ManualMemberSet(groupId, member, isMember_);
    }

    // -----------------------------
    // NFT membership (register + hold)
    // -----------------------------
    /// @notice Set NFT contract for membership (only in NFT mode).
    function setGroupNft(uint256 groupId, address nft)
        external
        onlyGroupOwner(groupId)
    {
        if (nft == address(0)) revert ZeroAddress();

        Groups.MembershipType t = _groupMembershipType(groupId);
        if (t != Groups.MembershipType.NFT) {
            revert MembershipTypeMismatch(uint8(t), uint8(Groups.MembershipType.NFT));
        }

        groupNft[groupId] = nft;
        emit GroupNftSet(groupId, nft);
    }

    /// @notice Register as a member in an NFT group.
    /// Must hold NFT at registration, and still must hold NFT at voting via isMember.
    function registerWithNft(uint256 groupId) external onlyExistingGroup(groupId) {
        Groups.MembershipType t = _groupMembershipType(groupId);
        if (t != Groups.MembershipType.NFT) {
            revert MembershipTypeMismatch(uint8(t), uint8(Groups.MembershipType.NFT));
        }

        address owner = _groupOwner(groupId);
        if (msg.sender == owner) revert OwnerMembershipImmutable(groupId, owner);

        if (nftRegistered[groupId][msg.sender]) revert NftAlreadyRegistered(groupId, msg.sender);

        address nft = groupNft[groupId];
        if (nft == address(0)) revert NftNotSet(groupId);

        if (IERC721(nft).balanceOf(msg.sender) == 0) {
            revert NftBalanceRequired(groupId, msg.sender);
        }

        nftRegistered[groupId][msg.sender] = true;
        _groupMemberCount[groupId] += 1;

        emit NftMemberRegistered(groupId, msg.sender);
        emit GroupMemberCountChanged(groupId, _groupMemberCount[groupId]);
    }

    /// @notice Unregister from an NFT group.
    /// Optional cleanup, does not require NFT ownership.
    function unregisterFromNft(uint256 groupId) external onlyExistingGroup(groupId) {
        Groups.MembershipType t = _groupMembershipType(groupId);
        if (t != Groups.MembershipType.NFT) {
            revert MembershipTypeMismatch(uint8(t), uint8(Groups.MembershipType.NFT));
        }

        if (!nftRegistered[groupId][msg.sender]) revert NftNotRegistered(groupId, msg.sender);

        nftRegistered[groupId][msg.sender] = false;
        _groupMemberCount[groupId] -= 1;

        emit NftMemberUnregistered(groupId, msg.sender);
        emit GroupMemberCountChanged(groupId, _groupMemberCount[groupId]);
    }

    // -----------------------------
    // ClaimCode membership
    // -----------------------------
    function createClaimCode(uint256 groupId, bytes32 codeHash)
        external
        onlyGroupOwner(groupId)
    {
        if (codeHash == bytes32(0)) revert ZeroCodeHash();

        Groups.MembershipType t = _groupMembershipType(groupId);
        if (t != Groups.MembershipType.ClaimCode) {
            revert MembershipTypeMismatch(uint8(t), uint8(Groups.MembershipType.ClaimCode));
        }

        if (claimCodeGroup[codeHash] != 0) revert ClaimCodeAlreadyExists(codeHash);

        claimCodeGroup[codeHash] = groupId;
        emit ClaimCodeCreated(groupId, codeHash);
    }

    function claimWithCode(uint256 groupId, bytes32 codeHash)
        external
        onlyExistingGroup(groupId)
    {
        if (codeHash == bytes32(0)) revert ZeroCodeHash();

        Groups.MembershipType t = _groupMembershipType(groupId);
        if (t != Groups.MembershipType.ClaimCode) {
            revert MembershipTypeMismatch(uint8(t), uint8(Groups.MembershipType.ClaimCode));
        }

        address owner = _groupOwner(groupId);
        if (msg.sender == owner) revert OwnerMembershipImmutable(groupId, owner);

        uint256 expectedGroupId = claimCodeGroup[codeHash];
        if (expectedGroupId == 0) revert ClaimCodeNotFound(codeHash);
        if (expectedGroupId != groupId) revert ClaimCodeWrongGroup(codeHash, expectedGroupId, groupId);

        if (claimCodeUsed[codeHash]) revert ClaimCodeAlreadyUsed(codeHash);

        // Effects
        claimCodeUsed[codeHash] = true;
        claimCodeOwner[codeHash] = msg.sender;

        bool was = manualMembers[groupId][msg.sender];

        // Store membership in manualMembers
        manualMembers[groupId][msg.sender] = true;

        // Update count only if not already a member
        if (!was) {
            _groupMemberCount[groupId] += 1;
            emit GroupMemberCountChanged(groupId, _groupMemberCount[groupId]);
        }

        emit ClaimCodeClaimed(groupId, codeHash, msg.sender);
    }

    // -----------------------------
    // Internal helper (used by VeritasCore)
    // -----------------------------
    function _isMemberInternal(uint256 groupId, address user) internal view returns (bool) {
        return isMember(groupId, user);
    }
}
