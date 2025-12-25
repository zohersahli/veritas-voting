// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/*
   Shared security base so modules can use whenNotPaused + nonReentrant.
   أساس أمني مشترك لكي تستخدم الموديولات whenNotPaused و nonReentrant.
*/
abstract contract VeritasSecurity is Pausable, ReentrancyGuard {}
