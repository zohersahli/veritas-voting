// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

/// @title IERC721Minimal 
/// @notice Minimal interface needed for NFT-based membership checks. 
interface IERC721Minimal {
    /// @notice Returns how many NFTs `owner` holds. 
    function balanceOf(address owner) external view returns (uint256);
}
