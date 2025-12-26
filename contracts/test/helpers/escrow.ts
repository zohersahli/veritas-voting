import { parseEther } from "ethers";

/**
 * Mint LINK and approve for spending
 * @param link LINK token contract
 * @param holder Signer to mint to
 * @param spender Address to approve
 * @param amount Amount to mint and approve
 */
export async function fundLinkAndApprove(link: any, holder: any, spender: string, amount = parseEther("10")) {
  await (await link.connect(holder).mint(holder.address, amount)).wait();
  await (await link.connect(holder).approve(spender, amount)).wait();
}

/**
 * Mint LINK and approve (alternative signature)
 */
export async function mintAndApproveLink(link: any, holder: any, spender: string, amount: bigint) {
  await link.mint(holder.address, amount);
  await link.connect(holder).approve(spender, amount);
}

/**
 * Create a poll with LINK escrow
 * @param core VeritasCore contract instance
 * @param link LINK token contract
 * @param owner Owner signer
 * @param groupId Group ID
 * @param startTime Start timestamp
 * @param endTime End timestamp
 * @param options Poll options array
 * @param quorumEnabled Whether quorum is enabled
 * @param quorumBps Quorum in basis points
 * @param linkAmount Amount of LINK to approve (default: 100 LINK)
 * @returns pollId
 */
export async function createPollWithEscrow(
  core: any,
  link: any,
  owner: any,
  groupId: bigint,
  startTime: number,
  endTime: number,
  options: string[],
  quorumEnabled = false,
  quorumBps = 0,
  linkAmount = parseEther("100")
) {
  await fundLinkAndApprove(link, owner, await core.getAddress(), linkAmount);

  await (
    await core
      .connect(owner)
      .createPollWithLinkEscrow(groupId, "T", "cid", options, startTime, endTime, quorumEnabled, quorumBps)
  ).wait();

  return await core.nextPollId();
}

/**
 * Top up LINK escrow for a poll
 * @param core VeritasCore contract instance
 * @param link LINK token contract
 * @param holder Signer to mint from
 * @param pollId Poll ID
 * @param amount Amount to top up
 */
export async function topUpEscrow(core: any, link: any, holder: any, pollId: bigint, amount: bigint) {
  await fundLinkAndApprove(link, holder, await core.getAddress(), amount);
  await (await core.connect(holder).topUpLink(pollId, amount)).wait();
}

