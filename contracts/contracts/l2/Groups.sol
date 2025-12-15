// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

/// @title Groups (L2) | 
/// @notice Stores groups and their immutable membership type (skeleton). 
/// @dev No membership logic here. Only group metadata + membershipType lock. 
abstract contract Groups {
    // -----------------------------
    // Errors 
    // -----------------------------
    error EmptyName();
    error InvalidGroup(uint256 groupId);

    // -----------------------------
    // Types 
    // -----------------------------
    // NOTE: Keep in sync with Membership.sol enum later.
    enum MembershipType {
        Manual,
        NFT,
        ClaimCode
    }

    struct Group {
        uint256 id;
        address owner;
        MembershipType membershipType; // immutable after creation (by design)
        string name;
        string description;
        uint64 createdAt;
    }

    // -----------------------------
    // Storage | ŘŞŘ®Ř˛ŮŠŮ†
    // -----------------------------
    uint256 public nextGroupId;
    mapping(uint256 => Group) public groups;

    // -----------------------------
    // Events | ŘŁŘ­ŘŻŘ§Ř«
    // -----------------------------
    event GroupCreated(
        uint256 indexed groupId,
        address indexed owner,
        MembershipType membershipType,
        string name
    );

    // -----------------------------
    // Functions | ŘŻŮŘ§Ů„
    // -----------------------------
    /// @notice Create a new group and lock membership type forever. | ŘĄŮ†Ř´Ř§Řˇ Ů…Ř¬Ů…ŮŘąŘ© ŮŘŞŘ«Ř¨ŮŠŘŞ Ů†ŮŘą Ř§Ů„ŘąŘ¶ŮŮŠŘ© Ů„Ů„ŘŁŘ¨ŘŻ
    function createGroup(
        string calldata name,
        string calldata description,
        MembershipType membershipType
    ) external returns (uint256 groupId) {
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

    /// @notice Check group exists. | Ř§Ů„ŘŞŘ­Ů‚Ů‚ ŘŁŮ† Ř§Ů„Ů…Ř¬Ů…ŮŘąŘ© Ů…ŮŘ¬ŮŘŻŘ©
    function groupExists(uint256 groupId) external view returns (bool) {
        return groups[groupId].owner != address(0);
    }

    // TODO (English only):
    // - Add owner-only admin actions later (if needed)
    // - No function to change membershipType (intentionally)
}
