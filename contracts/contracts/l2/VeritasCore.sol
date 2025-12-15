// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

import { Groups } from "./Groups.sol";
import { Membership } from "./Membership.sol";
import { Polls } from "./Polls.sol";
import { Voting } from "./Voting.sol";
import { Delegation } from "./Delegation.sol";
import { FinalizationL2 } from "./FinalizationL2.sol";

/// @title VeritasCore (L2) | العقد الرئيسي على L2
/// @notice Single entry point that aggregates all L2 modules via inheritance (skeleton).
///         نقطة الدخول الوحيدة التي تجمع كل وحدات L2 عبر الوراثة (سكلتون).
/// @dev Deploy only this contract on L2. Inherited modules are compiled into the same bytecode.
///      ننشر هذا العقد فقط على L2, وجميع الوحدات الموروثة تندمج داخله.
///
/// TODO (English only):
/// - Add cross-module checks (membership + poll timing + option validation)
/// - Decide whether to expose module functions directly or add wrapper functions here
contract VeritasCore is Groups, Membership, Polls, Voting, Delegation, FinalizationL2 {
    // Intentionally empty for now.
}
