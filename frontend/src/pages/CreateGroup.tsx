import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  useSimulateContract,
  useWaitForTransactionReceipt,
  useWriteContract,
  useConnection,
  useChainId,
  useSwitchChain,
} from "wagmi";
import { veritasCoreAbi, veritasCoreAddress, MembershipType } from "@/lib/veritas";
import { CHAIN_IDS } from "@/config/contracts";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/Card";
import { TransactionStatus } from "@/components/TransactionStatus";
import {
  decodeEventLog,
  isAddress,
  type GetTransactionReceiptReturnType,
} from "viem";
import { Users, Shield, Ticket } from "lucide-react";
import { toast } from "@/hooks/useToast";

type Receipt = GetTransactionReceiptReturnType;

type MyGroupsNavState = {
  createdGroupId?: string;
};

function hasGroupId(args: unknown): args is { groupId: bigint } {
  return (
    !!args &&
    typeof args === "object" &&
    "groupId" in args &&
    typeof (args as { groupId?: unknown }).groupId === "bigint"
  );
}

function extractGroupIdFromReceipt(receipt?: Receipt): bigint | null {
  if (!receipt) return null;

  const coreAddr = veritasCoreAddress.toLowerCase();

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== coreAddr) continue;

    try {
      const decoded = decodeEventLog({
        abi: veritasCoreAbi,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName !== "GroupCreated") continue;
      if (!hasGroupId(decoded.args)) continue;

      return decoded.args.groupId;
    } catch {
      // AR: Ignore logs that don't decode with our ABI.
      // EN: Ignore logs that don't decode with our ABI.
    }
  }

  return null;
}

export function CreateGroup() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { address, status } = useConnection();
  const isConnected = status === "connected";

  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const isCorrectChain = chainId === CHAIN_IDS.baseSepolia;

  const ensureBaseSepolia = useCallback(async (): Promise<boolean> => {
    if (chainId === CHAIN_IDS.baseSepolia) return true;

    try {
      await switchChainAsync({ chainId: CHAIN_IDS.baseSepolia });
      return true;
    } catch (err) {
      console.error("Failed to switch chain:", err);
      toast.error("Network switch was rejected or failed");
      return false;
    }
  }, [chainId, switchChainAsync]);

  // Prevent duplicate auto setGroupNft sends if the effect re-runs (e.g., after switchChain updates chainId).
  const setGroupNftInFlightRef = useRef(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [membershipType, setMembershipType] = useState<MembershipType>(
    MembershipType.Manual
  );
  const [nftAddress, setNftAddress] = useState("");

  const isFormReady = name.trim().length > 0 && description.trim().length > 0;
  const needsNft = membershipType === MembershipType.NFT;
  const isNftValid = !needsNft || isAddress(nftAddress);

  // Simulate createGroup (always force Base Sepolia)
  const { data: simulateData, error: simulateError } = useSimulateContract({
    chainId: CHAIN_IDS.baseSepolia,
    address: veritasCoreAddress,
    abi: veritasCoreAbi,
    functionName: "createGroup",
    args: [name, description, membershipType],
    account: (address ?? undefined) as `0x${string}` | undefined,
    query: { enabled: isFormReady && isConnected },
  });

  // Create Group Tx
  const {
    writeContractAsync: createGroupAsync,
    data: createHash,
    error: writeError,
    isPending: isCreatePending,
  } = useWriteContract();

  const {
    isLoading: isCreateConfirming,
    isSuccess: isCreateSuccess,
    data: _createReceipt,
  } = useWaitForTransactionReceipt({
    hash: createHash,
    chainId: CHAIN_IDS.baseSepolia,
    query: { enabled: Boolean(createHash) },
  });

  const createReceipt = _createReceipt as Receipt | undefined;

  useEffect(() => {
    if (!isCreateSuccess) return;
    queryClient.invalidateQueries();
  }, [isCreateSuccess, queryClient]);

  // Derive groupId without setState in effect
  const createdGroupId = useMemo(() => {
    if (!isCreateSuccess) return null;
    return extractGroupIdFromReceipt(createReceipt);
  }, [createReceipt, isCreateSuccess]);

  // Set Group NFT Tx
  const {
    writeContractAsync: setGroupNftAsync,
    data: setNftHash,
    error: setNftError,
    isPending: isSetNftPending,
  } = useWriteContract();

  const { isLoading: isSetNftConfirming, isSuccess: isSetNftSuccess } =
    useWaitForTransactionReceipt({
      hash: setNftHash,
      chainId: CHAIN_IDS.baseSepolia,
      query: { enabled: Boolean(setNftHash) },
    });

  const isPending =
    isCreatePending ||
    isCreateConfirming ||
    isSetNftPending ||
    isSetNftConfirming;

  const isUiLocked =
    isPending || (needsNft ? isCreateSuccess && !isSetNftSuccess : isCreateSuccess);

  // Auto-call setGroupNft after group creation if NFT type
  useEffect(() => {
    if (!isCreateSuccess) return;
    if (membershipType !== MembershipType.NFT) return;
    if (createdGroupId === null) return;
    if (!isAddress(nftAddress)) return;
    if (setNftHash) return;
    if (!isConnected || !address) return;

    // If a previous run is already in flight, don't start another.
    if (setGroupNftInFlightRef.current) return;

    let cancelled = false;

    const run = async () => {
      setGroupNftInFlightRef.current = true;
      try {
        const ok = await ensureBaseSepolia();
        if (!ok || cancelled) return;

        // Re-check: if another run already sent the tx while we were switching chains, do nothing.
        if (setNftHash) return;

        await setGroupNftAsync({
          chainId: CHAIN_IDS.baseSepolia,
          address: veritasCoreAddress,
          abi: veritasCoreAbi,
          functionName: "setGroupNft",
          args: [createdGroupId, nftAddress as `0x${string}`],
        });
      } catch (err) {
        console.error("setGroupNft failed:", err);
        toast.error("Failed to set NFT address");
      } finally {
        setGroupNftInFlightRef.current = false;
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    isCreateSuccess,
    membershipType,
    createdGroupId,
    nftAddress,
    setNftHash,
    setGroupNftAsync,
    ensureBaseSepolia,
    isConnected,
    address,
  ]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!isConnected || !address) {
      toast.error("Connect your wallet first");
      return;
    }

    if (!isFormReady) return;
    if (!isNftValid) {
      toast.error("Invalid NFT address");
      return;
    }

    if (simulateError) {
      console.error("Simulation failed:", simulateError);
      toast.error("Simulation failed");
      return;
    }
    if (!simulateData) return;

    const ok = await ensureBaseSepolia();
    if (!ok) return;

    try {
      await createGroupAsync({
        chainId: CHAIN_IDS.baseSepolia,
        address: veritasCoreAddress,
        abi: veritasCoreAbi,
        functionName: "createGroup",
        args: [name, description, membershipType],
      });
    } catch (err) {
      console.error("createGroup failed:", err);
      toast.error("Transaction was rejected or failed");
    }
  };

  const isSuccess =
    membershipType === MembershipType.NFT
      ? isCreateSuccess && isSetNftSuccess
      : isCreateSuccess;

  const error = writeError || setNftError;
  const hash = setNftHash || createHash;

  const goToMyGroups = () => {
    const state: MyGroupsNavState | undefined =
      createdGroupId !== null ? { createdGroupId: createdGroupId.toString() } : undefined;

    navigate("/my-groups", state ? { state } : undefined);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Create a New Group</h1>
        <p className="text-muted-foreground">
          Start a new community for voting and governance.
        </p>

        {isConnected && !isCorrectChain ? (
          <p className="text-xs text-yellow-500">
            You are on the wrong network. Switch to Base Sepolia to create a group.
          </p>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Group Details</CardTitle>
          <CardDescription>Define the core settings for your group.</CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <Input
              label="Group Name"
              placeholder="e.g. DeFi Alliance"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={isUiLocked}
            />

            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <textarea
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder="What is this group about?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                disabled={isUiLocked}
              />
            </div>

            <div className="space-y-3">
              <label className="text-sm font-medium">Membership Type</label>

              <div
                className={`grid grid-cols-1 md:grid-cols-3 gap-4 ${
                  isUiLocked ? "opacity-70 pointer-events-none select-none" : ""
                }`}
              >
                <div
                  role="button"
                  tabIndex={0}
                  className={`border rounded-lg p-4 cursor-pointer transition-all ${
                    membershipType === MembershipType.Manual
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "hover:border-primary/50"
                  }`}
                  onClick={() => setMembershipType(MembershipType.Manual)}
                >
                  <Users className="mb-2 h-6 w-6 text-primary" />
                  <div className="font-semibold">Manual</div>
                  <div className="text-xs text-muted-foreground">
                    Admin adds members manually
                  </div>
                </div>

                <div
                  role="button"
                  tabIndex={0}
                  className={`border rounded-lg p-4 cursor-pointer transition-all ${
                    membershipType === MembershipType.NFT
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "hover:border-primary/50"
                  }`}
                  onClick={() => setMembershipType(MembershipType.NFT)}
                >
                  <Ticket className="mb-2 h-6 w-6 text-purple-500" />
                  <div className="font-semibold">NFT Gate</div>
                  <div className="text-xs text-muted-foreground">
                    Holders of an NFT collection
                  </div>
                </div>

                <div
                  role="button"
                  tabIndex={0}
                  className={`border rounded-lg p-4 cursor-pointer transition-all ${
                    membershipType === MembershipType.ClaimCode
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "hover:border-primary/50"
                  }`}
                  onClick={() => setMembershipType(MembershipType.ClaimCode)}
                >
                  <Shield className="mb-2 h-6 w-6 text-green-500" />
                  <div className="font-semibold">Claim Code</div>
                  <div className="text-xs text-muted-foreground">
                    Distribute unique invite codes
                  </div>
                </div>
              </div>
            </div>

            {needsNft && (
              <Input
                label="NFT Contract Address"
                placeholder="0x..."
                value={nftAddress}
                onChange={(e) => setNftAddress(e.target.value)}
                required
                disabled={isUiLocked}
                error={nftAddress && !isAddress(nftAddress) ? "Invalid address" : undefined}
              />
            )}

            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={
                !isConnected ||
                isPending ||
                !simulateData ||
                !!simulateError ||
                !isFormReady ||
                !isNftValid
              }
              isLoading={isPending}
            >
              {isCreatePending || isCreateConfirming
                ? "Creating Group..."
                : isSetNftPending || isSetNftConfirming
                ? "Setting NFT Address..."
                : "Create Group"}
            </Button>
          </form>

          {simulateError && (
            <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-red-500 text-sm font-medium">Simulation Error:</p>
              <p className="text-red-400 text-xs mt-1">{simulateError.message}</p>
            </div>
          )}

          <TransactionStatus
            status={isPending ? "pending" : isSuccess ? "success" : error ? "error" : "idle"}
            hash={hash}
            error={error}
            chainId={CHAIN_IDS.baseSepolia}
          />

          {isCreateSuccess && needsNft && !isSetNftSuccess && (
            <div className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <p className="text-yellow-500 text-sm">Group created! Setting NFT address...</p>
            </div>
          )}

          {isSuccess && (
            <div className="mt-4 p-4 bg-green-500/10 border border-green-500/20 rounded-lg text-center">
              <p className="text-green-500 font-medium mb-2">
                Group created successfully{needsNft ? " and NFT address set" : ""}!
              </p>

              {createdGroupId !== null && (
                <p className="text-sm text-muted-foreground mb-2">
                  Group ID: {createdGroupId.toString()}
                </p>
              )}

              <Button variant="outline" onClick={goToMyGroups}>
                Go to My Groups
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
