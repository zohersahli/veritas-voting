// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

/// @title PlatformConfig (L1) | إعدادات المنصة على L1
/// @notice Stores platform fees, treasury and executor compensation (skeleton).
///         يخزن رسوم المنصة والخزنة وتعويض المنفذ (سكلتون).
/// @dev Keep config centralized to avoid duplicated constants across contracts.
///      نجمع الإعدادات في عقد واحد لتجنب تكرار الثوابت.
contract PlatformConfig {
    // -----------------------------
    // Errors | أخطاء
    // -----------------------------
    error NotOwner();
    error ZeroAddress();
    error BadBps(uint16 bps);
    error FeeCapExceeded(uint16 bps, uint16 cap);
    error CompensationCapExceeded(uint256 value, uint256 cap);


    // -----------------------------
    // Constants | ثوابت
    // -----------------------------
    uint16 public constant MAX_BPS = 10_000; // BPS scale: 10,000 = 100% (base for all fee percentages)
    uint16 public constant DEFAULT_SUCCESS_FEE_BPS = 700; // 7%  // Default platform fee on success: 700 bps = 7%
    uint16 public constant DEFAULT_FAILED_REFUND_FEE_BPS = 300; // 3%  // Default fee taken from refund when quorum fails: 300 bps = 3%
    uint16 public constant MAX_SUCCESS_FEE_CAP_BPS = 1000; // 10%  // Safety cap: success fee cannot exceed 1,000 bps = 10%
    uint16 public constant MAX_FAILED_REFUND_FEE_CAP_BPS = 500; // 5%  // Safety cap: failed-quorum refund fee cannot exceed 500 bps = 5%
    uint256 public constant MAX_EXECUTOR_COMPENSATION = 0.02 ether; // 0.02 ETH  // Safety cap: executor compensation cannot exceed 0.02 ETH (stored as wei)


    // -----------------------------
    // Owner | المالك
    // -----------------------------
    address public immutable owner;

    // -----------------------------
    // Config | الإعدادات
    // -----------------------------
    address public treasury;
    uint16 public feeOnSuccessBps;
    uint16 public feeOnFailedRefundBps;
    uint256 public executorCompensation; // fixed amount (wei), paid from deposit

    // -----------------------------
    // Events | أحداث
    // -----------------------------
    event TreasurySet(address indexed treasury);
    event FeesSet(uint16 feeOnSuccessBps, uint16 feeOnFailedRefundBps);
    event ExecutorCompensationSet(uint256 compensation);

    constructor(address treasury_, uint256 executorCompensation_) {
        owner = msg.sender;
        if (treasury_ == address(0)) revert ZeroAddress();
        if (executorCompensation_ > MAX_EXECUTOR_COMPENSATION) {
        revert CompensationCapExceeded(executorCompensation_, MAX_EXECUTOR_COMPENSATION);
        }

        treasury = treasury_;
        feeOnSuccessBps = DEFAULT_SUCCESS_FEE_BPS;
        feeOnFailedRefundBps = DEFAULT_FAILED_REFUND_FEE_BPS;
        executorCompensation = executorCompensation_;

        emit TreasurySet(treasury_);
        emit FeesSet(feeOnSuccessBps, feeOnFailedRefundBps);
        emit ExecutorCompensationSet(executorCompensation_);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // -----------------------------
    // Setters (placeholders) | تحديث الإعدادات
    // -----------------------------
    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    function setFees(uint16 successBps, uint16 failedRefundBps) external onlyOwner {
        if (successBps > MAX_BPS) revert BadBps(successBps);
        if (failedRefundBps > MAX_BPS) revert BadBps(failedRefundBps);
        if (successBps > MAX_SUCCESS_FEE_CAP_BPS) revert FeeCapExceeded(successBps, MAX_SUCCESS_FEE_CAP_BPS);
        if (failedRefundBps > MAX_FAILED_REFUND_FEE_CAP_BPS) revert FeeCapExceeded(failedRefundBps, MAX_FAILED_REFUND_FEE_CAP_BPS);


        feeOnSuccessBps = successBps;
        feeOnFailedRefundBps = failedRefundBps;

        emit FeesSet(successBps, failedRefundBps);
    }

   function setExecutorCompensation(uint256 compensation) external onlyOwner {
    if (compensation > MAX_EXECUTOR_COMPENSATION) {
        revert CompensationCapExceeded(compensation, MAX_EXECUTOR_COMPENSATION);
    }
    executorCompensation = compensation;
    emit ExecutorCompensationSet(compensation);
    }


}
