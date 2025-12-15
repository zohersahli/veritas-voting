// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;
import { Groups } from "./Groups.sol";
import { IERC721Minimal } from "../interfaces/IERC721Minimal.sol";

/// @title Membership (L2) | 
/// @notice Handles membership checks for groups (Manual, NFT, ClaimCode) (skeleton). | 
/// @dev Voting contract will call isMember(...) before allowing votes. | 
abstract contract Membership {
    // -----------------------------
    // Errors | 
    // -----------------------------
    error NotGroupOwner(uint256 groupId);
    error UnsupportedMembershipType(uint8 membershipType);

    // -----------------------------
    // Types | 
    // -----------------------------
   

    // -----------------------------
    // Storage |
    // -----------------------------
    // Manual membership: owner approves members
    mapping(uint256 => mapping(address => bool)) public manualMembers;

    // NFT membership: groupId -> NFT contract address
    mapping(uint256 => address) public groupNft;

    // Claim code: codeHash -> used, and who claimed (optional)
    mapping(bytes32 => bool) public claimCodeUsed;
    mapping(bytes32 => address) public claimCodeOwner;

    // -----------------------------
    // Events 
    // -----------------------------
    event ManualMemberSet(uint256 indexed groupId, address indexed member, bool isMember);
    event GroupNftSet(uint256 indexed groupId, address indexed nft);
    event ClaimCodeCreated(uint256 indexed groupId, bytes32 indexed codeHash);
    event ClaimCodeClaimed(uint256 indexed groupId, bytes32 indexed codeHash, address indexed member);

    // -----------------------------
    // External API (skeleton)
    // -----------------------------

    /// @notice Returns true if user is member of group according to membership type. 
    function isMember(uint256 groupId, address user, Groups.MembershipType membershipType) external view returns (bool) {

        if (membershipType == Groups.MembershipType.Manual) {
            return manualMembers[groupId][user];
        }

        if (membershipType == Groups.MembershipType.NFT) {
            address nft = groupNft[groupId];
            if (nft == address(0)) return false;
            // Minimal check: balanceOf(user) > 0
            return IERC721Minimal(nft).balanceOf(user) > 0;
        }

        if (membershipType == Groups.MembershipType.ClaimCode) {
            // In ClaimCode mode, membership is represented by manualMembers as "claimed members"
            return manualMembers[groupId][user];
        }

        revert UnsupportedMembershipType(uint8(membershipType));
    }

    // -----------------------------
    // Manual membership (placeholders)
    // -----------------------------
    function setManualMember(uint256 groupId, address member, bool isMember_) external {
        // TODO: only group owner
        manualMembers[groupId][member] = isMember_;
        emit ManualMemberSet(groupId, member, isMember_);
    }

    // -----------------------------
    // NFT membership (placeholders) 
    // -----------------------------
    function setGroupNft(uint256 groupId, address nft) external {
        // TODO: only group owner
        groupNft[groupId] = nft;
        emit GroupNftSet(groupId, nft);
    }

    // -----------------------------
    // Claim code (placeholders) 
    // -----------------------------
    function createClaimCode(uint256 groupId, bytes32 codeHash) external {
        // TODO: only group owner, prevent reuse
        emit ClaimCodeCreated(groupId, codeHash);
    }

    function claimWithCode(uint256 groupId, bytes32 codeHash) external {
        // TODO: verify code exists, mark used, bind to msg.sender
        manualMembers[groupId][msg.sender] = true;
        claimCodeUsed[codeHash] = true;
        claimCodeOwner[codeHash] = msg.sender;
        emit ClaimCodeClaimed(groupId, codeHash, msg.sender);
    }

    // TODO (English only):
    // - Integrate Groups.sol to verify group owner + membershipType
    // - Store claim codes per group and enforce one-time use
}
