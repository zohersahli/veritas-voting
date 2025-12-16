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
    error ZeroAddress();
    error InvalidAmount();
    error NoDeposit(uint256 groupId, uint256 pollId);
    error AlreadyDeposited(uint256 groupId, uint256 pollId);
    error AlreadySettled(uint256 groupId, uint256 pollId);
    error InsufficientDeposit(uint256 required, uint256 available);
    error SendFailed();
    error ZeroExecutor();

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
    mapping(bytes32 => DepositInfo) public deposits; // key = keccak256(abi.encode(groupId, pollId)) // pollId => deposit info
    function _key(uint256 groupId, uint256 pollId) internal pure returns (bytes32) {
    // English: Use abi.encode for unambiguous encoding.
    // نستخدم abi.encode لتفادي أي التباس بالترميز.
        return keccak256(abi.encode(groupId, pollId));
    }


    // -----------------------------
    // Registry authorization | صلاحيات عقد التسجيل
    // -----------------------------
    error NotConfigOwner(); // Only PlatformConfig owner can set the registry
    error NotRegistry(); // Only the registry can settle
    error RegistryAlreadySet(); // Registry can be set once

    address public registry; // L1ResultRegistry address

    event RegistrySet(address indexed registry); // Emitted once when registry is set

    modifier onlyRegistry() {
        if (msg.sender != registry) revert NotRegistry();
        _;
    }

    /// @notice Set registry once (L1ResultRegistry).
    /// @dev Caller must be PlatformConfig owner.
    /// تعيين عقد التسجيل مرة واحدة فقط بواسطة مالك PlatformConfig.
    function setRegistry(address registry_) external {
        if (msg.sender != config.owner()) revert NotConfigOwner();
        if (registry != address(0)) revert RegistryAlreadySet();
        if (registry_ == address(0)) revert ZeroAddress();

        registry = registry_;
        emit RegistrySet(registry_);
    }


    // -----------------------------
    // Events | أحداث
    // -----------------------------
    event Deposited(uint256 indexed groupId, uint256 indexed pollId, address indexed creator, uint256 amount);
    event PaidOnSuccess(
        uint256 indexed groupId,
        uint256 indexed pollId,
        address indexed executor,
        uint256 feeToTreasury,
        uint256 compensationToExecutor,
        uint256 refundToCreator
    );
    event RefundedOnFailedQuorum(
        uint256 indexed groupId,
        uint256 indexed pollId,
        uint256 feeToTreasury,
        uint256 refundToCreator
    );

    constructor(address config_) {
        if (config_ == address(0)) revert ZeroAddress();
        config = PlatformConfig(config_);
    }

    // -----------------------------
    // Deposit | إيداع
    // -----------------------------
    function depositForPoll(uint256 groupId, uint256 pollId) external payable {
        if (msg.value == 0) revert InvalidAmount();

        bytes32 k = _key(groupId, pollId);

        // One deposit per (groupId, pollId).
        // إيداع واحد فقط لكل (groupId, pollId).
        if (deposits[k].amount != 0) revert AlreadyDeposited(groupId, pollId);

        deposits[k] = DepositInfo({
            creator: msg.sender,
            amount: msg.value,
            settled: false
        });

        emit Deposited(groupId, pollId, msg.sender, msg.value);
    }

    // -----------------------------
    // Success payout | توزيع عند النجاح
    // -----------------------------
    function payOnSuccess(uint256 groupId, uint256 pollId, address executor) external onlyRegistry {
        if (executor == address(0)) revert ZeroExecutor();

        bytes32 k = _key(groupId, pollId);

        DepositInfo storage d = deposits[k];
        if (d.amount == 0) revert NoDeposit(groupId, pollId);
        if (d.settled) revert AlreadySettled(groupId, pollId);

        uint256 amount = d.amount;

        // CEI pattern: effects first.
        // نثبت الحالة أولا ثم التحويلات لتقليل مخاطر reentrancy.
        d.settled = true;

        uint256 fee = (amount * config.feeOnSuccessBps()) / config.MAX_BPS();
        uint256 compensation = config.executorCompensation();

        uint256 required = fee + compensation;
        if (amount < required) revert InsufficientDeposit(required, amount);

        uint256 refund = amount - required;

        (bool ok1, ) = payable(config.treasury()).call{value: fee}("");
        if (!ok1) revert SendFailed();

        //  Pay the real executor, not msg.sender (registry).
        //  ندفع التعويض للمنفذ الحقيقي وليس لعقد الـ registry.
        (bool ok2, ) = payable(executor).call{value: compensation}("");
        if (!ok2) revert SendFailed();

        (bool ok3, ) = payable(d.creator).call{value: refund}("");
        if (!ok3) revert SendFailed();

        emit PaidOnSuccess(groupId, pollId, executor, fee, compensation, refund);
    }

    // -----------------------------
    // Failed quorum refund | استرجاع عند فشل النصاب
    // -----------------------------
    function refundOnFailedQuorum(uint256 groupId, uint256 pollId) external onlyRegistry {
        bytes32 k = _key(groupId, pollId);

        DepositInfo storage d = deposits[k];
        if (d.amount == 0) revert NoDeposit(groupId, pollId);
        if (d.settled) revert AlreadySettled(groupId, pollId);

        uint256 amount = d.amount;
        // CEI pattern: effects first.
        // نثبت الحالة أولا ثم التحويلات لتقليل مخاطر reentrancy.
        d.settled = true;

        uint256 fee = (amount * config.feeOnFailedRefundBps()) / config.MAX_BPS();
        uint256 refund = amount - fee;

        (bool ok4, ) = payable(config.treasury()).call{value: fee}("");
        if (!ok4) revert SendFailed();

        (bool ok5, ) = payable(d.creator).call{value: refund}("");
        if (!ok5) revert SendFailed();

        emit RefundedOnFailedQuorum(groupId, pollId, fee, refund);
    }

}
