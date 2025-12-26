import { network } from "hardhat";

async function getEthers() {
  const { ethers } = await network.connect();
  return ethers;
}

/**
 * Set timestamp for the next mined block
 */
export async function setTime(ts: number) {
  const ethers = await getEthers();
  await ethers.provider.send("evm_setNextBlockTimestamp", [ts]);
  await ethers.provider.send("evm_mine", []);
}

/**
 * Set timestamp for the next block (without mining)
 */
export async function setNextTimestamp(ts: number) {
  const ethers = await getEthers();
  await ethers.provider.send("evm_setNextBlockTimestamp", [ts]);
}

/**
 * Get future time window (startTime, endTime)
 * @param offsetSeconds Offset from current time (default: 10)
 * @param durationSeconds Duration of the window (default: 1000)
 */
export async function getFutureWindow(offsetSeconds = 10, durationSeconds = 1000) {
  const ethers = await getEthers();
  const latest = await ethers.provider.getBlock("latest");
  const startTime = Number(latest!.timestamp) + offsetSeconds;
  const endTime = startTime + durationSeconds;
  return { startTime, endTime };
}

/**
 * Advance time by specified seconds
 */
export async function advanceTime(seconds: number) {
  const ethers = await getEthers();
  const latest = await ethers.provider.getBlock("latest");
  const newTime = Number(latest!.timestamp) + seconds;
  await setTime(newTime);
}

