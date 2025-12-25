// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/*
Mock LINK token for localhost testing.
توكن LINK وهمي للاختبارات على localhost.
*/
contract MockLink is ERC20 {
    /*
    Deploys the mock token with name and symbol.
    ينشر التوكن الوهمي باسم ورمز.
    */
    constructor() ERC20("Mock LINK", "mLINK") {}

    /*
    Mints tokens to an address for testing.
    يقوم بعمل mint لتوكنات للاختبار.
    */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
