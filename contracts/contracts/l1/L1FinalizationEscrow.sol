// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

import { PlatformConfig } from "./PlatformConfig.sol";

/// @title L1FinalizationEscrow (L1) | إيداع وتوزيع الرسوم على L1
/// @notice Holds deposits for polls and pays executor + fees + refunds (skeleton).
///         يحتفظ بإيداع الـ Poll ويوزع تعويض المنفذ والرسوم والاسترجاع (سكلتون).
/// @dev Sender pays gas. Executor gets compensated from the deposit.
///      مرسل المعاملة يدفع الغاز، والمنفذ يأخذ تعويضه من الإيداع.
contract L1FinalizationEscrow {
    // -----------------------------
    // Errors | أخطاء
    // -----------------------------
    error InvalidAmount();
    error NoDeposit(uint256 pollId);
    error AlreadySettled(uint256 pollId);
    error SendFailed();

    // -----------------------------
    // Types | أنواع
    // -----------------------------
    struct DepositInfo {
        address creator;
        uint256 amount;
        bool settled;
    }

    // -----------------------------
    // Config | إعدادات
    // -----------------------------
    PlatformConfig public immutable config;

    // -----------------------------
    // Storage | تخزين
    // -----------------------------
    mapping(uint256 => DepositInfo) public deposits; // pollId => deposit info

    // -----------------------------
    // Events | أحداث
    // -----------------------------
    event Deposited(uint256 indexed pollId, address indexed creator, uint256 amount);
    event PaidOnSuccess(
        uint256 indexed pollId,
        address indexed executor,
        uint256 feeToTreasury,
        uint256 executorCompensation,
        uint256 refundToCreator
    );
    event RefundedOnFailedQuorum(
        uint256 indexed pollId,
        uint256 feeToTreasury,
        uint256 refundToCreator
    );

    constructor(address config_) {
        config = PlatformConfig(config_);
    }

    // -----------------------------
    // Deposit | إيداع
    // -----------------------------
    function depositForPoll(uint256 pollId) external payable {
        if (msg.value == 0) revert InvalidAmount();

        // TODO:
        // - Decide if multiple deposits allowed or only once
        // - Prevent overwrite if already deposited

        deposits[pollId] = DepositInfo({
            creator: msg.sender,
            amount: msg.value,
            settled: false
        });

        emit Deposited(pollId, msg.sender, msg.value);
    }

    // -----------------------------
    // Success payout | توزيع عند النجاح
    // -----------------------------
    function payOnSuccess(uint256 pollId, address executor) external {
        DepositInfo storage d = deposits[pollId];
        if (d.amount == 0) revert NoDeposit(pollId);
        if (d.settled) revert AlreadySettled(pollId);

        // TODO:
        // - Verify caller authorization (bot/registry/anyone) - later
        // - Integrate with L1ResultRegistry to ensure result recorded - later

        uint256 amount = d.amount;
        d.settled = true;

        uint256 fee = (amount * config.feeOnSuccessBps()) / config.MAX_BPS();
        uint256 compensation = config.executorCompensation();

        // NOTE: In real logic we must ensure amount >= fee + compensation.
        uint256 refund = amount - fee - compensation;

        // TODO: add stronger safety patterns (pull payments / reentrancy guards) later

        (bool ok1, ) = payable(config.treasury()).call{value: fee}("");
        if (!ok1) revert SendFailed();

        (bool ok2, ) = payable(executor).call{value: compensation}("");
        if (!ok2) revert SendFailed();

        (bool ok3, ) = payable(d.creator).call{value: refund}("");
        if (!ok3) revert SendFailed();

        emit PaidOnSuccess(pollId, executor, fee, compensation, refund);
    }

    // -----------------------------
    // Failed quorum refund | استرجاع عند فشل النصاب
    // -----------------------------
    function refundOnFailedQuorum(uint256 pollId) external {
        DepositInfo storage d = deposits[pollId];
        if (d.amount == 0) revert NoDeposit(pollId);
        if (d.settled) revert AlreadySettled(pollId);

        uint256 amount = d.amount;
        d.settled = true;

        uint256 fee = (amount * config.feeOnFailedRefundBps()) / config.MAX_BPS();
        uint256 refund = amount - fee;

        (bool ok4, ) = payable(config.treasury()).call{value: fee}("");
        if (!ok4) revert SendFailed();

        (bool ok5, ) = payable(d.creator).call{value: refund}("");
        if (!ok5) revert SendFailed();

        emit RefundedOnFailedQuorum(pollId, fee, refund);
    }

    // TODO:
    // - Add amount validation: amount >= fee + compensation
    // - Add authorization rules for payOnSuccess/refundOnFailedQuorum
    // - Consider pull-payments to reduce reentrancy risk
}
