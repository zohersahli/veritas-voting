// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

import { L1FinalizationEscrow } from "./L1FinalizationEscrow.sol";

/// @title L1ResultRegistry (L1) | Final results registry on L1
/// @notice Records finalized poll results once (immutable) and triggers escrow settlement.
/// Arabic: يسجل نتائج التصويت النهائية مرة واحدة فقط ويشغل تسوية الـ escrow إن وُجد إيداع.
/// @dev Does NOT verify L2 truth. It stores what is submitted (MVP assumption).
/// Arabic: لا يتحقق من صحة نتيجة L2, فقط يخزن ما يتم إرساله (افتراض MVP).
contract L1ResultRegistry {
    // -----------------------------
    // Errors
    // -----------------------------
    error ZeroAddress();
    error AlreadyRecorded(uint256 groupId, uint256 pollId);

    // -----------------------------
    // Types
    // -----------------------------
    enum FinalizationStatus {
        Success,     // Quorum passed and finalized
        FailedQuorum // Quorum failed
    }

    // -----------------------------
    // Config
    // -----------------------------
    L1FinalizationEscrow public immutable escrow;

    // -----------------------------
    // Storage
    // -----------------------------
    // key = keccak256(abi.encode(groupId, pollId))
    mapping(bytes32 => bool) public recorded;
    mapping(bytes32 => bytes32) public resultHashOf;
    mapping(bytes32 => FinalizationStatus) public statusOf;

    // -----------------------------
    // Events
    // -----------------------------
    event ResultRecorded(
        uint256 indexed groupId,
        uint256 indexed pollId,
        bytes32 indexed key,
        uint8 status, // 0 = Success, 1 = FailedQuorum
        bytes32 resultHash,
        address executor
    );

    event EscrowSettlementSkipped(
        uint256 indexed groupId,
        uint256 indexed pollId,
        bytes32 indexed key
    );

    event EscrowSettlementAttempted(
        uint256 indexed groupId,
        uint256 indexed pollId,
        bytes32 indexed key,
        bool success
    );

    constructor(address escrow_) {
        if (escrow_ == address(0)) revert ZeroAddress();
        escrow = L1FinalizationEscrow(escrow_);
    }

    // -----------------------------
    // Helpers
    // -----------------------------
    function keyOf(uint256 groupId, uint256 pollId) public pure returns (bytes32) {
        //  Use abi.encode for unambiguous encoding.
        // نستخدم abi.encode لتفادي أي التباس بالترميز.
        return keccak256(abi.encode(groupId, pollId));
    }

    // -----------------------------
    // Record
    // -----------------------------
    /// @notice Record final result ONCE for (groupId, pollId) and attempt escrow settlement.
    /// Arabic: تسجيل النتيجة مرة واحدة فقط ثم محاولة تسوية الـ escrow إن كان هناك إيداع.
    /// @param groupId Group identifier
    /// @param pollId Poll identifier
    /// @param status Finalization status (Success / FailedQuorum)
    /// @param resultHash Hash of finalized result data (packed/hashed off-chain or from L2 event)
    function recordResult(
        uint256 groupId,
        uint256 pollId,
        FinalizationStatus status,
        bytes32 resultHash
    ) external {
        bytes32 k = keyOf(groupId, pollId);

        if (recorded[k]) revert AlreadyRecorded(groupId, pollId);

        // Effects first
        recorded[k] = true;
        statusOf[k] = status;
        resultHashOf[k] = resultHash;

        emit ResultRecorded(groupId, pollId, k, uint8(status), resultHash, msg.sender);

        // Attempt escrow settlement if a deposit exists and is not settled.
        // نحاول التسوية فقط إذا يوجد إيداع ولم تتم تسويته.
        ( , uint256 amount, bool settled) = escrow.deposits(k);

        if (amount == 0 || settled) {
            emit EscrowSettlementSkipped(groupId, pollId, k);
            return;
        }

        // Attempt settlement via escrow (escrow only accepts calls from registry address).
        if (status == FinalizationStatus.Success) {
            //  Pay fee + compensation + refund
            //  دفع الرسوم + تعويض المنفذ + استرجاع المنشئ
            // Pass the real executor (EOA) so escrow pays compensation to them.
            try escrow.payOnSuccess(groupId, pollId, msg.sender) {
                emit EscrowSettlementAttempted(groupId, pollId, k, true);
            } catch {
                emit EscrowSettlementAttempted(groupId, pollId, k, false);
            }
        } else {
            //  Refund creator minus failed-quorum fee (no compensation)
            //  استرجاع للمنشئ ناقص رسوم الفشل (بدون تعويض)
            try escrow.refundOnFailedQuorum(groupId, pollId) {
                emit EscrowSettlementAttempted(groupId, pollId, k, true);
            } catch {
                emit EscrowSettlementAttempted(groupId, pollId, k, false);
            }
        }
    }
}
