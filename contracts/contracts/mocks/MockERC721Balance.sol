// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

///  Minimal ERC721-like mock with controllable balances.
contract MockERC721Balance {
    mapping(address => uint256) private _bal;

    function setBalance(address user, uint256 b) external {
        _bal[user] = b;
    }

    function balanceOf(address user) external view returns (uint256) {
        return _bal[user];
    }
}
