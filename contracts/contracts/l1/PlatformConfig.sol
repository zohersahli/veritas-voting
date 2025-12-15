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

    // -----------------------------
    // Constants | ثوابت
    // -----------------------------
    uint16 public constant MAX_BPS = 10_000;
    uint16 public constant DEFAULT_SUCCESS_FEE_BPS = 700; // 7%
    uint16 public constant DEFAULT_FAILED_REFUND_FEE_BPS = 300; // 3%

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

        feeOnSuccessBps = successBps;
        feeOnFailedRefundBps = failedRefundBps;

        emit FeesSet(successBps, failedRefundBps);
    }

    function setExecutorCompensation(uint256 compensation) external onlyOwner {
        executorCompensation = compensation;
        emit ExecutorCompensationSet(compensation);
    }

    // TODO (English only):
    // - Add max caps for fees/compensation (risk control)
}
