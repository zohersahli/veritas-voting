// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/*
Mock LINK token for localhost testing.
*/
contract MockLink is ERC20 {
    /*
    Deploys the mock token with name and symbol.
    */
    constructor() ERC20("Mock LINK", "mLINK") {}

    /*
    Mints tokens to an address for testing.
    */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
