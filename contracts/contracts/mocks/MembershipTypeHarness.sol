// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { Membership } from "../l2/Membership.sol";
import { Groups } from "../l2/Groups.sol";

/**
 * EN: Harness to test Membership.isMember branches without touching core contracts.
 * AR: هارنس لاختبار فروع isMember بدون تعديل العقود الأساسية.
 */
contract MembershipTypeHarness is Membership {
    struct G {
        bool exists;
        address owner;
        uint8 membershipTypeRaw; // can be any value 0..255
    }

    mapping(uint256 => G) internal _g;

    function setGroup(uint256 groupId, bool exists_, address owner_, uint8 membershipTypeRaw_) external {
        _g[groupId] = G({
            exists: exists_,
            owner: owner_,
            membershipTypeRaw: membershipTypeRaw_
        });
    }

    // ---------- hooks ----------
    function _groupExists(uint256 groupId) internal view override returns (bool) {
        return _g[groupId].exists;
    }

    function _groupOwner(uint256 groupId) internal view override returns (address) {
        return _g[groupId].owner;
    }

    function _groupMembershipType(uint256 groupId)
        internal
        view
        override
        returns (Groups.MembershipType t)
    {
        uint8 raw = _g[groupId].membershipTypeRaw;

        // IMPORTANT:
        // EN: Do NOT use `return(0x00, 0x20)` here, it would exit the whole call.
        // AR: ممنوع استخدام return opcode هنا لأنه ينهي تنفيذ الاستدعاء بالكامل.
        assembly {
            t := raw
        }
    }
}
