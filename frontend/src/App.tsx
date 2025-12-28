import React from "react";
import VeritasCoreAbiJson from "./abis/VeritasCore.json";
import { CONTRACTS } from "./config/contracts";
import {
  useConnect,
  useConnection,
  useDisconnect,
  useReadContract,
  useSwitchChain,
} from "wagmi";
import type { Abi } from "viem";

const VeritasCoreAbi = VeritasCoreAbiJson as unknown as Abi;

export default function App() {
  const contractAddress = CONTRACTS.baseSepolia.VeritasCore as `0x${string}`;
  const targetChainId = CONTRACTS.baseSepolia.chainId;

  const { address, chainId, isConnected, status } = useConnection();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  const onWrongChain = isConnected && chainId !== targetChainId;
  const enabled = isConnected && chainId === targetChainId;

  const ownerQ = useReadContract({
    address: contractAddress,
    abi: VeritasCoreAbi,
    functionName: "owner",
    query: { enabled },
  });

  const nextGroupIdQ = useReadContract({
    address: contractAddress,
    abi: VeritasCoreAbi,
    functionName: "nextGroupId",
    query: { enabled },
  });

  const nextPollIdQ = useReadContract({
    address: contractAddress,
    abi: VeritasCoreAbi,
    functionName: "nextPollId",
    query: { enabled },
  });

  const platformFeeBpsQ = useReadContract({
    address: contractAddress,
    abi: VeritasCoreAbi,
    functionName: "platformFeeBps",
    query: { enabled },
  });

  const opsFeeFlatQ = useReadContract({
    address: contractAddress,
    abi: VeritasCoreAbi,
    functionName: "opsFeeFlat",
    query: { enabled },
  });

  const treasuryQ = useReadContract({
    address: contractAddress,
    abi: VeritasCoreAbi,
    functionName: "treasury",
    query: { enabled },
  });

  const firstError =
    ownerQ.error ??
    nextGroupIdQ.error ??
    nextPollIdQ.error ??
    platformFeeBpsQ.error ??
    opsFeeFlatQ.error ??
    treasuryQ.error;

  const errorText = firstError
    ? firstError instanceof Error
      ? firstError.message
      : String(firstError)
    : "";

  const ownerText = ownerQ.data ? String(ownerQ.data) : "";
  const nextGroupIdText = nextGroupIdQ.data ? String(nextGroupIdQ.data) : "";
  const nextPollIdText = nextPollIdQ.data ? String(nextPollIdQ.data) : "";
  const platformFeeBpsText = platformFeeBpsQ.data
    ? String(platformFeeBpsQ.data)
    : "";
  const opsFeeFlatText = opsFeeFlatQ.data ? String(opsFeeFlatQ.data) : "";
  const treasuryText = treasuryQ.data ? String(treasuryQ.data) : "";

  const anyLoading =
    ownerQ.isLoading ||
    nextGroupIdQ.isLoading ||
    nextPollIdQ.isLoading ||
    platformFeeBpsQ.isLoading ||
    opsFeeFlatQ.isLoading ||
    treasuryQ.isLoading;

  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Veritas Frontend Smoke Test</h1>

      <p>
        <strong>Connection:</strong> {status}
      </p>

      <p>
        <strong>Wallet:</strong> {address ?? "Not connected"}
      </p>

      <p>
        <strong>Wallet chainId:</strong> {chainId ?? "unknown"}
      </p>

      <button
        onClick={() => connect({ connector: connectors[0] })}
        disabled={isConnected || isPending || connectors.length === 0}
      >
        Connect
      </button>

      <button
        onClick={() => disconnect()}
        disabled={!isConnected}
        style={{ marginLeft: 8 }}
      >
        Disconnect
      </button>

      <button
        onClick={() => switchChain({ chainId: targetChainId })}
        disabled={!onWrongChain || isSwitching}
        style={{ marginLeft: 8 }}
      >
        Switch to Base Sepolia
      </button>

      <hr style={{ margin: "16px 0" }} />

      <p>
        <strong>Network target:</strong> Base Sepolia (chainId {targetChainId})
      </p>

      <p>
        <strong>VeritasCore:</strong> {contractAddress}
      </p>

      <p>
        <strong>owner():</strong> {ownerText || "..."}
      </p>
      <p>
        <strong>nextGroupId():</strong> {nextGroupIdText || "..."}
      </p>
      <p>
        <strong>nextPollId():</strong> {nextPollIdText || "..."}
      </p>
      <p>
        <strong>platformFeeBps():</strong> {platformFeeBpsText || "..."}
      </p>
      <p>
        <strong>opsFeeFlat():</strong> {opsFeeFlatText || "..."}
      </p>
      <p>
        <strong>treasury():</strong> {treasuryText || "..."}
      </p>

      {onWrongChain && (
        <p style={{ color: "crimson" }}>
          Wrong network. Please switch to Base Sepolia (chainId {targetChainId}
          ).
        </p>
      )}

      {anyLoading && <p>Loading contract reads...</p>}
      {errorText && <p style={{ color: "crimson" }}>Error: {errorText}</p>}
    </div>
  );
}
