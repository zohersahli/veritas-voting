// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract MockERC721 is ERC721 {
    uint256 public nextId;

    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) {}

    function mint(address to) external returns (uint256 tokenId) {
        tokenId = ++nextId;
        _mint(to, tokenId);
    }

    function burn(uint256 tokenId) external {
        _burn(tokenId);
    }
}
