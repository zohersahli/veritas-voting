// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title Groups (L2)
/// @notice Stores groups and their immutable membership type.
/// @dev No membership logic here. Only group metadata + membershipType lock.
/// EN: Membership type is locked at creation.
/// AR: نوع العضوية ثابت عند الإنشاء.
abstract contract Groups {
    // -----------------------------
    // Errors
    // -----------------------------
    error EmptyName();
    error InvalidGroup(uint256 groupId);

    // -----------------------------
    // Types
    // -----------------------------
    enum MembershipType {
        Manual,   // owner manages members
        NFT,      // register + hold NFT at vote time
        ClaimCode // membership via one-time claim codes (stored as manual members)
    }

    struct Group {
        uint256 id;
        address owner;
        MembershipType membershipType;
        string name;
        string description;
        uint64 createdAt;
    }

    // -----------------------------
    // Storage
    // -----------------------------
    uint256 public nextGroupId;
    mapping(uint256 => Group) public groups;

    // -----------------------------
    // Events
    // -----------------------------
    event GroupCreated(
        uint256 indexed groupId,
        address indexed owner,
        MembershipType membershipType,
        string name
    );

    // -----------------------------
    // Functions
    // -----------------------------
    function createGroup(
        string calldata name,
        string calldata description,
        MembershipType membershipType
    ) public virtual returns (uint256 groupId) {
        if (bytes(name).length == 0) revert EmptyName();

        unchecked {
            groupId = ++nextGroupId;
        }

        groups[groupId] = Group({
            id: groupId,
            owner: msg.sender,
            membershipType: membershipType,
            name: name,
            description: description,
            createdAt: uint64(block.timestamp)
        });

        emit GroupCreated(groupId, msg.sender, membershipType, name);
    }

    function groupExists(uint256 groupId) external view returns (bool) {
        return groups[groupId].owner != address(0);
    }
}
