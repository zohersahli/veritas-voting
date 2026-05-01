import { useEffect, useMemo, useState } from "react";
import {
  useBalance,
  useConnection,
  useDisconnect,
  useReadContract,
  useReadContracts,
} from "wagmi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/CopyButton";
import { Badge } from "@/components/ui/Badge";
import { shortenAddress, formatWeiToEth } from "@/utils/format";
import { ExternalLink, Wallet, LogOut, Settings, Bell } from "lucide-react";

import { veritasCoreAbi, veritasCoreAddress } from "@/lib/veritas";
import { CHAIN_IDS } from "@/config/contracts";

function getChainName(id: number) {
  switch (id) {
    case 84532:
      return "Base Sepolia";
    case 11155111:
      return "Ethereum Sepolia";
    case 1:
      return "Ethereum Mainnet";
    case 8453:
      return "Base";
    default:
      return `Chain ${id}`;
  }
}

function getExplorerUrl(addr: string, chainId: number) {
  if (chainId === 84532) return `https://sepolia.basescan.org/address/${addr}`;
  if (chainId === 11155111) return `https://sepolia.etherscan.io/address/${addr}`;
  return "#";
}

function clampBigintToNumber(value: bigint, cap: number) {
  const capBig = BigInt(cap);
  if (value <= 0n) return 0;
  if (value > capBig) return cap;
  return Number(value);
}

type PollTupleLike = readonly unknown[];

/**
 * AR/EN:
 * Extract creator from getPoll result safely.
 * Handles tuple or object shape.
 */
function extractCreatorFromPoll(result: unknown): string | null {
  if (!result) return null;

  // Tuple shape (most common in some wagmi/viem cases)
  if (Array.isArray(result)) {
    const t = result as PollTupleLike;
    const creator = t[2];
    if (typeof creator === "string") return creator;
    return null;
  }

  // Object shape
  if (typeof result === "object") {
    const obj = result as Record<string, unknown>;
    const creator = obj["creator"];
    if (typeof creator === "string") return creator;
  }

  return null;
}

export function Profile() {
  const { address, chainId, isConnected } = useConnection();
  const disconnect = useDisconnect();

  const { data: balance } = useBalance({
    address,
    query: { enabled: isConnected && Boolean(address) },
  });

  // Notifications toggle (simple and safe)
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("veritas_notifications_enabled") === "true";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      "veritas_notifications_enabled",
      notificationsEnabled ? "true" : "false"
    );
  }, [notificationsEnabled]);

  // Activity Summary (on-chain without subgraph)
  const chainIdSafe = chainId ?? CHAIN_IDS.baseSepolia;

  const MAX_GROUP_SCAN = 200;
  const MAX_POLL_SCAN = 200;

  const { data: nextGroupIdData } = useReadContract({
    chainId: CHAIN_IDS.baseSepolia,
    address: veritasCoreAddress,
    abi: veritasCoreAbi,
    functionName: "nextGroupId",
    query: { enabled: isConnected },
  });

  const { data: nextPollIdData } = useReadContract({
    chainId: CHAIN_IDS.baseSepolia,
    address: veritasCoreAddress,
    abi: veritasCoreAbi,
    functionName: "nextPollId",
    query: { enabled: isConnected },
  });

  const nextGroupId = (typeof nextGroupIdData === "bigint" ? nextGroupIdData : 0n) as bigint;
  const nextPollId = (typeof nextPollIdData === "bigint" ? nextPollIdData : 0n) as bigint;

  const groupScanCount = useMemo(() => {
    // group ids usually start at 1, and nextGroupId is "next to be assigned"
    const maxExisting = nextGroupId > 0n ? nextGroupId - 1n : 0n;
    return clampBigintToNumber(maxExisting, MAX_GROUP_SCAN);
  }, [nextGroupId]);

  const pollScanCount = useMemo(() => {
    const maxExisting = nextPollId > 0n ? nextPollId - 1n : 0n;
    return clampBigintToNumber(maxExisting, MAX_POLL_SCAN);
  }, [nextPollId]);

  const groupIds = useMemo(() => {
    if (!isConnected || !address) return [];
    if (groupScanCount <= 0) return [];
    return Array.from({ length: groupScanCount }, (_, i) => BigInt(i + 1));
  }, [isConnected, address, groupScanCount]);

  const pollIds = useMemo(() => {
    if (!isConnected || !address) return [];
    if (pollScanCount <= 0) return [];
    return Array.from({ length: pollScanCount }, (_, i) => BigInt(i + 1));
  }, [isConnected, address, pollScanCount]);

  const groupMemberReads = useReadContracts({
    contracts: groupIds.map((gid) => ({
      chainId: CHAIN_IDS.baseSepolia,
      address: veritasCoreAddress,
      abi: veritasCoreAbi,
      functionName: "isMember" as const,
      args: [gid, address! as `0x${string}`] as const,
    })),
    query: { enabled: isConnected && Boolean(address) && groupIds.length > 0 },
  });

  const pollCreatorReads = useReadContracts({
    contracts: pollIds.map((pid) => ({
      chainId: CHAIN_IDS.baseSepolia,
      address: veritasCoreAddress,
      abi: veritasCoreAbi,
      functionName: "getPoll" as const,
      args: [pid] as const,
    })),
    query: { enabled: isConnected && Boolean(address) && pollIds.length > 0 },
  });

  const hasVotedReads = useReadContracts({
    contracts: pollIds.map((pid) => ({
      chainId: CHAIN_IDS.baseSepolia,
      address: veritasCoreAddress,
      abi: veritasCoreAbi,
      functionName: "hasVoted" as const,
      args: [pid, address! as `0x${string}`] as const,
    })),
    query: { enabled: isConnected && Boolean(address) && pollIds.length > 0 },
  });

  const groupsJoined = useMemo(() => {
    const list = groupMemberReads.data ?? [];
    let count = 0;
    for (const item of list) {
      if (item?.status === "success" && item.result === true) count += 1;
    }
    return count;
  }, [groupMemberReads.data]);

  const pollsCreated = useMemo(() => {
    if (!address) return 0;
    const addr = address.toLowerCase();
    const list = pollCreatorReads.data ?? [];
    let count = 0;

    for (const item of list) {
      if (item?.status !== "success") continue;
      const creator = extractCreatorFromPoll(item.result);
      if (creator && creator.toLowerCase() === addr) count += 1;
    }

    return count;
  }, [pollCreatorReads.data, address]);

  const votesCast = useMemo(() => {
    const list = hasVotedReads.data ?? [];
    let count = 0;
    for (const item of list) {
      if (item?.status === "success" && item.result === true) count += 1;
    }
    return count;
  }, [hasVotedReads.data]);

  const scanLimitedGroups = useMemo(() => {
    const maxExisting = nextGroupId > 0n ? nextGroupId - 1n : 0n;
    return maxExisting > BigInt(MAX_GROUP_SCAN);
  }, [nextGroupId]);

  const scanLimitedPolls = useMemo(() => {
    const maxExisting = nextPollId > 0n ? nextPollId - 1n : 0n;
    return maxExisting > BigInt(MAX_POLL_SCAN);
  }, [nextPollId]);

  const groupsJoinedLabel = groupMemberReads.isLoading
    ? "Loading..."
    : scanLimitedGroups
    ? `${groupsJoined}+`
    : String(groupsJoined);

  const pollsCreatedLabel = pollCreatorReads.isLoading
    ? "Loading..."
    : scanLimitedPolls
    ? `${pollsCreated}+`
    : String(pollsCreated);

  const votesCastLabel = hasVotedReads.isLoading
    ? "Loading..."
    : scanLimitedPolls
    ? `${votesCast}+`
    : String(votesCast);

  const delegationsLabel = "0";

  if (!isConnected || !address) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardContent className="pt-6 text-center py-12">
            <Wallet className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2">Connect Your Wallet</h2>
            <p className="text-muted-foreground">Please connect your wallet to view your profile</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleDisconnect = () => {
    disconnect.mutate({});
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Profile</h1>
        <p className="text-muted-foreground">Manage your wallet and preferences</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Wallet Information
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Wallet Address</label>
            <div className="flex items-center justify-between p-4 bg-secondary/20 rounded-lg">
              <span className="font-mono text-sm">{shortenAddress(address)}</span>
              <div className="flex gap-2">
                <CopyButton value={address} />
                <Button variant="ghost" size="sm" asChild>
                  <a
                    href={getExplorerUrl(address, chainIdSafe)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Balance</label>
            <div className="p-4 bg-secondary/20 rounded-lg">
              <p className="text-2xl font-bold">
                {balance ? `${formatWeiToEth(balance.value)} ${balance.symbol}` : "Loading..."}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">Connected Network</label>
            <div className="flex items-center justify-between p-4 bg-secondary/20 rounded-lg">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <span className="font-medium">{getChainName(chainIdSafe)}</span>
              </div>
              <Badge variant="outline">Chain ID: {chainIdSafe}</Badge>
            </div>
          </div>

          <Button
            variant="destructive"
            className="w-full"
            disabled={disconnect.isPending}
            onClick={handleDisconnect}
          >
            <LogOut className="mr-2 h-4 w-4" />
            {disconnect.isPending ? "Disconnecting..." : "Disconnect Wallet"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Preferences
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="flex items-center gap-3">
              <Bell className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium">Notifications</p>
                <p className="text-sm text-muted-foreground">
                  Enable local notifications preference (UI only for now)
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Badge variant="outline">{notificationsEnabled ? "On" : "Off"}</Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNotificationsEnabled((v) => !v)}
              >
                {notificationsEnabled ? "Disable" : "Enable"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-secondary/20 rounded-lg">
              <p className="text-2xl font-bold">{groupsJoinedLabel}</p>
              <p className="text-sm text-muted-foreground">Groups Joined</p>
            </div>
            <div className="text-center p-4 bg-secondary/20 rounded-lg">
              <p className="text-2xl font-bold">{pollsCreatedLabel}</p>
              <p className="text-sm text-muted-foreground">Polls Created</p>
            </div>
            <div className="text-center p-4 bg-secondary/20 rounded-lg">
              <p className="text-2xl font-bold">{votesCastLabel}</p>
              <p className="text-sm text-muted-foreground">Votes Cast</p>
            </div>
            <div className="text-center p-4 bg-secondary/20 rounded-lg">
              <p className="text-2xl font-bold">{delegationsLabel}</p>
              <p className="text-sm text-muted-foreground">Delegations</p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center mt-4">
            Note: counts are computed on-chain by scanning up to {MAX_GROUP_SCAN} groups and{" "}
            {MAX_POLL_SCAN} polls for performance.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
