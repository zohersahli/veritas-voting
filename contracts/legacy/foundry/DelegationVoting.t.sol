// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

import "forge-std/Test.sol";

import { VeritasCore } from "../contracts/l2/VeritasCore.sol";
import { Groups } from "../contracts/l2/Groups.sol";
import { Delegation } from "../contracts/l2/Delegation.sol";
import { Voting } from "../contracts/l2/Voting.sol";

/// @notice Test harness to expose internal _createPoll for tests only.
/// AR: Harness للتست فقط لفتح _createPoll لأنها internal.
contract VeritasCoreHarness is VeritasCore {
    constructor()
        VeritasCore(
            address(0x1111111111111111111111111111111111111111), // router
            address(0x2222222222222222222222222222222222222222), // link
            uint64(1),                                          // destSelector dummy
            address(0x3333333333333333333333333333333333333333), // l1Receiver
            address(0x4444444444444444444444444444444444444444), // treasury
            200000                                              // receiverGasLimit
        )
    {}

    /// @notice Expose internal _createPoll for tests.
    /// AR: دالة إنشاء poll للتست فقط.
    function createPollPublic(
        uint256 groupId,
        string calldata title,
        string calldata cid,
        string[] calldata options,
        uint64 startTime,
        uint64 endTime,
        bool quorumEnabled,
        uint16 quorumBps
    ) external returns (uint256 pollId) {
        return _createPoll(groupId, title, cid, options, startTime, endTime, quorumEnabled, quorumBps);
    }
}

contract DelegationVotingTest is Test {
    VeritasCoreHarness core;

    address owner;
    address A;
    address B;
    address C;

    uint256 groupId;
    uint256 pollId;

    function setUp() public {
        core = new VeritasCoreHarness();

        owner = vm.addr(100);
        A = vm.addr(1);
        B = vm.addr(2);
        C = vm.addr(3);

        // Create group as owner
        // AR: إنشاء مجموعة بواسطة المالك
        vm.prank(owner);
        groupId = core.createGroup("G", "D", Groups.MembershipType.Manual);

        // Add members A,B,C manually (Manual mode)
        // AR: إضافة أعضاء للمجموعة
        vm.prank(owner);
        core.setManualMember(groupId, A, true);

        vm.prank(owner);
        core.setManualMember(groupId, B, true);

        vm.prank(owner);
        core.setManualMember(groupId, C, true);

        // Create poll with voting window starting soon
        // AR: إنشاء Poll
        string;
        opts[0] = "YES";
        opts[1] = "NO";

        uint64 startTime = uint64(block.timestamp + 10);
        uint64 endTime = uint64(block.timestamp + 1000);

        vm.prank(owner);
        pollId = core.createPollPublic(
            groupId,
            "P1",
            "cid",
            opts,
            startTime,
            endTime,
            false,
            0
        );

        // Move time into voting window
        // AR: ندخل نافذة التصويت
        vm.warp(startTime + 1);
    }

    function test_DelegationScenario_A_C_to_B_then_B_votes_and_locks() public {
        // A delegates to B
        // AR: A يفوض B
        vm.prank(A);
        core.delegate(pollId, B);

        // C delegates to B
        // AR: C يفوض B
        vm.prank(C);
        core.delegate(pollId, B);

        // B cannot delegate because B has incoming delegations (no chains rule)
        // AR: B لا يمكنه التفويض لأن لديه incoming
        vm.prank(B);
        vm.expectRevert(
            abi.encodeWithSelector(
                Delegation.DelegationDelegatorHasIncoming.selector,
                pollId,
                B
            )
        );
        core.delegate(pollId, A);

        // B votes option 0
        // AR: B يصوت ويأخذ وزن 3 (B + A + C)
        vm.prank(B);
        core.vote(pollId, 0);

        // voteCounts should be 3
        // AR: نتأكد أن العداد صار 3
        uint256 count = core.voteCounts(pollId, 0);
        assertEq(count, 3);

        // A cannot revoke after B voted (locked)
        // AR: A لا يستطيع revoke بعد تصويت B
        vm.prank(A);
        vm.expectRevert(
            abi.encodeWithSelector(
                Delegation.DelegationLockedAfterDelegateVoted.selector,
                pollId,
                A,
                B
            )
        );
        core.revoke(pollId);

        // C cannot revoke after B voted (locked)
        // AR: C لا يستطيع revoke بعد تصويت B
        vm.prank(C);
        vm.expectRevert(
            abi.encodeWithSelector(
                Delegation.DelegationLockedAfterDelegateVoted.selector,
                pollId,
                C,
                B
            )
        );
        core.revoke(pollId);

        // Optional extra safety: A cannot vote directly because they delegated
        // AR: A لا يمكنه التصويت لأنه مفوض
        vm.prank(A);
        vm.expectRevert(
            abi.encodeWithSelector(
                Voting.VotingDelegated.selector,
                pollId,
                A,
                B
            )
        );
        core.vote(pollId, 0);
    }
}
