// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

/// @title Delegation (L2) | تفويض التصويت على L2
/// @notice Stores simple delegations (delegator -> delegate) per group (skeleton).
///         يخزن تفويض بسيط (المفوِض -> المفوَض إليه) لكل مجموعة (سكلتون).
/// @dev Voting/Finalization will later decide how to use delegation (e.g., counting rules).
///      التصويت/الإنهاء لاحقا يحدد كيف يستخدم التفويض (قواعد العد).
abstract contract Delegation {
    // -----------------------------
    // Errors | أخطاء
    // -----------------------------
    error SelfDelegationNotAllowed(address account);

    // -----------------------------
    // Storage | تخزين
    // -----------------------------
    // groupId => delegator => delegate
    mapping(uint256 => mapping(address => address)) public delegateOf;

    // -----------------------------
    // Events | أحداث
    // -----------------------------
    event Delegated(uint256 indexed groupId, address indexed delegator, address indexed delegate);
    event DelegationRevoked(uint256 indexed groupId, address indexed delegator);

    // -----------------------------
    // Actions | إجراءات
    // -----------------------------
    /// @notice Delegate voting power to another member within the same group.
    ///         تفويض حق التصويت لعضو آخر داخل نفس المجموعة.
    function delegate(uint256 groupId, address delegate_) external {
        if (delegate_ == msg.sender) revert SelfDelegationNotAllowed(msg.sender);

        // TODO:
        // - Verify both msg.sender and delegate_ are members of the group (Membership.sol)
        // - Optionally prevent delegating to address(0)
        // - Optionally prevent delegation cycles (future work)

        delegateOf[groupId][msg.sender] = delegate_;
        emit Delegated(groupId, msg.sender, delegate_);
    }

    /// @notice Revoke delegation for the caller in a group.
    ///         إلغاء التفويض للمُفوِض داخل مجموعة.
    function revoke(uint256 groupId) external {
        // TODO: if not set, decide whether to revert or be a no-op (later)
        delete delegateOf[groupId][msg.sender];
        emit DelegationRevoked(groupId, msg.sender);
    }
}
