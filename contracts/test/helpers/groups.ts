import { parseEther } from "ethers";

/**
 * Create a manual group with members
 * @param core VeritasCore contract instance
 * @param owner Owner signer
 * @param members Array of member addresses
 * @returns groupId
 */
export async function createManualGroupWithMembers(core: any, owner: any, members: string[]) {
  await (await core.connect(owner).createGroup("G", "D", 0)).wait();
  const groupId = await core.nextGroupId();

  for (const m of members) {
    await (await core.connect(owner).setManualMember(groupId, m, true)).wait();
  }

  return groupId;
}

/**
 * Create an NFT group
 * @param core VeritasCore contract instance
 * @param owner Owner signer
 * @param nftAddress NFT contract address
 * @returns { groupId, nft }
 */
export async function createNftGroup(core: any, owner: any, nftAddress?: string) {
  await (await core.connect(owner).createGroup("G-NFT", "D", 1)).wait();
  const groupId = await core.nextGroupId();

  if (nftAddress) {
    await (await core.connect(owner).setGroupNft(groupId, nftAddress)).wait();
    return { groupId, nft: null };
  } else {
    // Deploy mock NFT if not provided
    const { network } = await import("hardhat");
    const { ethers } = await network.connect();
    const MockERC721 = await ethers.getContractFactory("MockERC721");
    const nft = await MockERC721.deploy();
    await (await core.connect(owner).setGroupNft(groupId, await nft.getAddress())).wait();
    return { groupId, nft };
  }
}

/**
 * Create a ClaimCode group with a claim code
 * @param core VeritasCore contract instance
 * @param owner Owner signer
 * @param codeHash Claim code hash (bytes32)
 * @returns groupId
 */
export async function createClaimCodeGroup(core: any, owner: any, codeHash?: string) {
  await (await core.connect(owner).createGroup("G-CC", "D", 2)).wait();
  const groupId = await core.nextGroupId();

  if (codeHash) {
    await (await core.connect(owner).createClaimCode(groupId, codeHash)).wait();
  }

  return groupId;
}

/**
 * Helper to generate code hash from text
 */
export async function codeHash(text: string) {
  const { network } = await import("hardhat");
  const { ethers } = await network.connect();
  return ethers.keccak256(ethers.toUtf8Bytes(text));
}

