import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
  useSimulateContract,
  useConnection,
  useSwitchChain,
} from "wagmi";
import { veritasCoreAbi, veritasCoreAddress, linkTokenAddress } from "@/lib/veritas";
import { CHAIN_IDS } from "@/config/contracts";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardContent } from "@/components/ui/Card";
import { TransactionStatus } from "@/components/TransactionStatus";
import { Plus, Trash2, ArrowRight, Check, Loader2 } from "lucide-react";
import { parseEther, formatEther, zeroAddress } from "viem";
import { generateCidFromDescription } from "@/lib/ipfs";

// ERC20 ABI for LINK approval
const erc20Abi = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

type GroupTuple = readonly [
  bigint, // id
  `0x${string}`, // owner
  number, // membershipType
  string, // name
  string, // description
  bigint // createdAt
];

export function CreatePoll() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedGroupId = searchParams.get("groupId");

  const [step, setStep] = useState(1);
  const [groupId, setGroupId] = useState(preselectedGroupId || "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [options, setOptions] = useState(["Yes", "No"]);
  const [duration, setDuration] = useState(3); // days
  const [useQuorum] = useState(false);
  const [quorumBps] = useState(1000); // 10%
  const [cid, setCid] = useState<string>("");
  const [isGeneratingCid, setIsGeneratingCid] = useState(false);

  const START_TIME_BUFFER_SECONDS = 120;

  const { address, status, chainId } = useConnection();
  const isConnected = status === "connected";
  const connectedAddress = (isConnected ? address : zeroAddress) as `0x${string}`;

  const switchChain = useSwitchChain();
  const isOnBaseSepolia = chainId === CHAIN_IDS.baseSepolia;

  const queryClient = useQueryClient();

  // Parse groupId safely
  const groupIdBn = useMemo(() => {
    try {
      if (!groupId || groupId.trim().length === 0) return null;
      return BigInt(groupId);
    } catch {
      return null;
    }
  }, [groupId]);

  // Read group to enforce "only owner can create polls"
  const { data: groupData, isLoading: isGroupLoading } = useReadContract({
    address: veritasCoreAddress,
    abi: veritasCoreAbi,
    functionName: "groups",
    args: [groupIdBn ?? 0n],
    query: { enabled: Boolean(groupIdBn) },
  });

  const groupTuple = useMemo(() => {
    return groupData as unknown as GroupTuple | undefined;
  }, [groupData]);

  const groupOwner = groupTuple?.[1];

  const isGroupOwner = useMemo(() => {
    if (!isConnected || !address || !groupOwner) return false;
    return address.toLowerCase() === groupOwner.toLowerCase();
  }, [isConnected, address, groupOwner]);

  // Generate CID from description when description changes (avoid race)
  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!description || step < 2) {
        setCid("");
        setIsGeneratingCid(false);
        return;
      }

      setIsGeneratingCid(true);
      try {
        const newCid = await generateCidFromDescription(description);
        if (!cancelled) setCid(newCid);
      } catch (err) {
        console.error("Failed to generate CID:", err);
        if (!cancelled) setCid("");
      } finally {
        if (!cancelled) setIsGeneratingCid(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [description, step]);

  // Fees
  const { data: opsFeeFlat } = useReadContract({
    address: veritasCoreAddress,
    abi: veritasCoreAbi,
    functionName: "opsFeeFlat",
  });

  // Calculate required approval amount (opsFeeFlat + buffer for CCIP fees)
  const requiredApproval = useMemo(() => {
    if (!opsFeeFlat) return parseEther("1"); // Default 1 LINK
    const buffer = 10n;
    return (opsFeeFlat as bigint) * buffer;
  }, [opsFeeFlat]);

  // Check current allowance (only relevant for group owner)
  const { data: currentAllowance } = useReadContract({
    address: linkTokenAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: [connectedAddress, veritasCoreAddress],
    query: {
      enabled: isConnected && isGroupOwner,
    },
  });

  const needsApproval = useMemo(() => {
    if (!isConnected || !isGroupOwner) return false;
    if (currentAllowance === undefined) return true;
    return (currentAllowance as bigint) < requiredApproval;
  }, [isConnected, isGroupOwner, currentAllowance, requiredApproval]);

  // Simulate approve (only owner)
  const { data: simulateApprove, error: simulateApproveError } = useSimulateContract({
    address: linkTokenAddress,
    abi: erc20Abi,
    functionName: "approve",
    args: [veritasCoreAddress, requiredApproval],
    query: {
      enabled: isConnected && isGroupOwner && needsApproval,
    },
  });

  // Approve LINK Tx
  const approveWrite = useWriteContract();
  const approveHash = approveWrite.data;
  const approveError = approveWrite.error;
  const isApprovePending = approveWrite.isPending;

  const { isLoading: isApproveConfirming, isSuccess: isApproveConfirmed } =
    useWaitForTransactionReceipt({
      hash: approveHash,
      query: { enabled: Boolean(approveHash) },
    });

  // Approval is satisfied if we do not need approval OR approve tx confirmed
  const approvalSatisfied = isGroupOwner && (!needsApproval || isApproveConfirmed);

  // Calculate poll parameters
  const pollParams = useMemo(() => {
    const cleanTitle = title.trim();
    const cleanCid = cid.trim();
    const cleanOptions = options.map((o) => o.trim()).filter((o) => o.length > 0);

    if (!groupIdBn) return null;
    if (!cleanTitle) return null;
    if (!cleanCid) return null;
    if (cleanOptions.length < 2) return null;

    const now = Math.floor(Date.now() / 1000);
    const startTimeWithBuffer = now + START_TIME_BUFFER_SECONDS;
    const startTime = BigInt(startTimeWithBuffer);
    const endTime = BigInt(startTimeWithBuffer + duration * 24 * 60 * 60);

    const quorumBpsFinal = useQuorum ? quorumBps : 0;

    return {
      groupId: groupIdBn,
      title: cleanTitle,
      cid: cleanCid,
      options: cleanOptions,
      startTime,
      endTime,
      quorumEnabled: useQuorum,
      quorumBps: BigInt(quorumBpsFinal),
    };
  }, [groupIdBn, title, cid, options, duration, useQuorum, quorumBps]);

  const now = Math.floor(Date.now() / 1000);
  const isStartTimeValid = pollParams ? Number(pollParams.startTime) >= now + 30 : false;

  // Simulate createPoll (only owner, params ready + approval satisfied)
  const { data: simulateCreatePoll, error: simulateCreatePollError } = useSimulateContract({
    address: veritasCoreAddress,
    abi: veritasCoreAbi,
    functionName: "createPollWithLinkEscrow",
    args: pollParams
      ? [
          pollParams.groupId,
          pollParams.title,
          pollParams.cid,
          pollParams.options,
          pollParams.startTime,
          pollParams.endTime,
          pollParams.quorumEnabled,
          pollParams.quorumBps,
        ]
      : undefined,
    query: {
      enabled: isConnected && isGroupOwner && approvalSatisfied && Boolean(pollParams),
    },
  });

  // Create Poll Tx
  const createPollWrite = useWriteContract();
  const pollHash = createPollWrite.data;
  const pollError = createPollWrite.error;
  const isPollPending = createPollWrite.isPending;

  const { isLoading: isPollConfirming, isSuccess: isPollConfirmed } =
    useWaitForTransactionReceipt({
      hash: pollHash,
      query: { enabled: Boolean(pollHash) },
    });

  useEffect(() => {
    if (!isPollConfirmed) return;
    queryClient.invalidateQueries();
  }, [isPollConfirmed, queryClient]);

  const isBusy = isApprovePending || isApproveConfirming || isPollPending || isPollConfirming;

  const handleAddOption = () => {
    if (isBusy) return;
    setOptions([...options, ""]);
  };

  const handleRemoveOption = (idx: number) => {
    if (isBusy) return;
    setOptions(options.filter((_, i) => i !== idx));
  };

  const handleOptionChange = (idx: number, val: string) => {
    if (isBusy) return;
    const newOptions = [...options];
    newOptions[idx] = val;
    setOptions(newOptions);
  };

  const handleApprove = () => {
    if (!isConnected) return;
    if (!isGroupOwner) return;

    if (!isOnBaseSepolia) {
      switchChain.mutate({ chainId: CHAIN_IDS.baseSepolia });
      return;
    }

    if (simulateApproveError) {
      console.error("Approve simulation failed:", simulateApproveError);
      return;
    }
    if (!simulateApprove) return;

    approveWrite.mutate({
      address: linkTokenAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [veritasCoreAddress, requiredApproval],
    });
  };

  const handleCreate = () => {
    if (!isConnected) return;
    if (!isGroupOwner) return;

    if (!isOnBaseSepolia) {
      switchChain.mutate({ chainId: CHAIN_IDS.baseSepolia });
      return;
    }

    if (!approvalSatisfied) return;
    if (!pollParams) return;

    if (simulateCreatePollError) {
      console.error("Create poll simulation failed:", simulateCreatePollError);
      return;
    }
    if (!simulateCreatePoll) return;

    createPollWrite.mutate({
      address: veritasCoreAddress,
      abi: veritasCoreAbi,
      functionName: "createPollWithLinkEscrow",
      args: [
        pollParams.groupId,
        pollParams.title,
        pollParams.cid,
        pollParams.options,
        pollParams.startTime,
        pollParams.endTime,
        pollParams.quorumEnabled,
        pollParams.quorumBps,
      ],
    });
  };

  // Hard UI guard: connected + groupId provided + group loaded + not owner
  if (isConnected && groupIdBn && !isGroupLoading && groupOwner && !isGroupOwner) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold">Create a Poll</h1>
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="text-sm">
              Only the group owner can create polls for this group.
            </div>
            <div className="text-xs text-muted-foreground">
              Group Owner: {groupOwner.slice(0, 6)}...{groupOwner.slice(-4)}
            </div>
            <div className="text-xs text-muted-foreground">
              Your Address: {connectedAddress.slice(0, 6)}...{connectedAddress.slice(-4)}
            </div>
            <Button
              type="button"
              variant="neon"
              onClick={() => navigate(`/groups/${groupIdBn.toString()}`)}
            >
              Back to Group
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Create a Poll</h1>
        <div className="flex gap-2 text-sm text-muted-foreground">
          <span className={step >= 1 ? "text-primary font-bold" : ""}>1. Details</span>
          <span>→</span>
          <span className={step >= 2 ? "text-primary font-bold" : ""}>2. Options</span>
          <span>→</span>
          <span className={step >= 3 ? "text-primary font-bold" : ""}>3. Fees & Launch</span>
        </div>
      </div>

      {!isConnected && (
        <div className="bg-secondary/20 border border-border rounded-lg p-4">
          <p className="font-medium">Connect Wallet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Please connect your wallet to approve LINK and create the poll.
          </p>
        </div>
      )}

      {isConnected && groupOwner !== undefined && (
        <div className="text-xs text-muted-foreground">
          Group Owner: {groupOwner.slice(0, 6)}...{groupOwner.slice(-4)}
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          {step === 1 && (
            <div className="space-y-6">
              <Input
                label="Group ID"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                placeholder="Enter Group ID"
                disabled={isBusy}
                error={
                  groupId.length > 0 && groupIdBn === null
                    ? "Group ID must be a valid number"
                    : undefined
                }
              />
              <Input
                label="Poll Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Should we invest in ETH?"
                disabled={isBusy}
              />
              <div className="space-y-2">
                <label className="text-sm font-medium">Description</label>
                <textarea
                  className="w-full min-h-[100px] rounded-md border border-input bg-background p-3 text-sm"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isBusy}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Duration (Days): {duration}</label>
                <input
                  type="range"
                  min="1"
                  max="30"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full"
                  disabled={isBusy}
                />
              </div>
              <Button
                className="w-full"
                onClick={() => setStep(2)}
                disabled={!groupIdBn || !title.trim() || isBusy}
              >
                Next: Options <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div className="space-y-4">
                <label className="text-sm font-medium">Voting Options</label>
                {options.map((opt, idx) => (
                  <div key={idx} className="flex gap-2">
                    <Input
                      value={opt}
                      onChange={(e) => handleOptionChange(idx, e.target.value)}
                      placeholder={`Option ${idx + 1}`}
                      disabled={isBusy}
                    />
                    {options.length > 2 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveOption(idx)}
                        disabled={isBusy}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button variant="outline" onClick={handleAddOption} size="sm" disabled={isBusy}>
                  <Plus className="mr-2 h-4 w-4" /> Add Option
                </Button>
              </div>
              <div className="flex gap-4">
                <Button variant="ghost" onClick={() => setStep(1)} disabled={isBusy}>
                  Back
                </Button>
                <Button className="flex-1" onClick={() => setStep(3)} disabled={isBusy}>
                  Next: Fees
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              {isConnected && Boolean(groupIdBn) && Boolean(groupOwner) && !isGroupOwner && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <p className="text-red-500 text-sm font-medium">
                    Only the group owner can create polls.
                  </p>
                </div>
              )}

              <div className="bg-secondary/20 p-4 rounded-lg space-y-2">
                <h3 className="font-semibold">Fee Breakdown</h3>
                <div className="flex justify-between text-sm">
                  <span>Cross-Chain Ops Fee (LINK)</span>
                  <span>{opsFeeFlat ? formatEther(opsFeeFlat as bigint) : "..."} LINK</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Required Approval</span>
                  <span>{formatEther(requiredApproval)} LINK</span>
                </div>

                {isConnected && isGroupOwner && currentAllowance !== undefined && (
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Current Allowance</span>
                    <span>{formatEther(currentAllowance as bigint)} LINK</span>
                  </div>
                )}
              </div>

              {!cid && description && step >= 2 && (
                <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                  {isGeneratingCid ? (
                    <div className="flex items-center gap-2 text-yellow-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm">Generating IPFS CID...</span>
                    </div>
                  ) : (
                    <p className="text-yellow-500 text-sm">
                      Failed to generate CID. Please check your description.
                    </p>
                  )}
                </div>
              )}

              {simulateApproveError && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <p className="text-red-500 text-sm font-medium">Approve Simulation Error:</p>
                  <p className="text-red-400 text-xs mt-1">{simulateApproveError.message}</p>
                </div>
              )}

              {simulateCreatePollError && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <p className="text-red-500 text-sm font-medium">Create Poll Simulation Error:</p>
                  <p className="text-red-400 text-xs mt-1">{simulateCreatePollError.message}</p>
                </div>
              )}

              <div className="space-y-4">
                <div className="flex items-center gap-4 border p-4 rounded-lg">
                  <div
                    className={`h-8 w-8 rounded-full flex items-center justify-center ${
                      approvalSatisfied ? "bg-green-500 text-white" : "bg-secondary"
                    }`}
                  >
                    {approvalSatisfied ? <Check className="h-5 w-5" /> : "1"}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">Approve LINK Token</p>
                    <p className="text-xs text-muted-foreground">
                      {!isConnected
                        ? "Connect wallet to continue"
                        : !isGroupOwner
                        ? "Only the group owner can approve and create polls"
                        : needsApproval
                        ? `Allow Veritas to spend ${formatEther(requiredApproval)} LINK for CCIP fees`
                        : "Already approved"}
                    </p>
                  </div>
                  <Button
                    onClick={handleApprove}
                    disabled={
                      !isConnected ||
                      !isGroupOwner ||
                      !needsApproval ||
                      approvalSatisfied ||
                      isApprovePending ||
                      isApproveConfirming ||
                      !!simulateApproveError
                    }
                    variant={approvalSatisfied ? "outline" : "default"}
                  >
                    {isApprovePending || isApproveConfirming
                      ? "Approving..."
                      : approvalSatisfied
                      ? "Approved"
                      : "Approve"}
                  </Button>
                </div>

                <div className="flex items-center gap-4 border p-4 rounded-lg">
                  <div
                    className={`h-8 w-8 rounded-full flex items-center justify-center ${
                      isPollConfirmed ? "bg-green-500 text-white" : "bg-secondary"
                    }`}
                  >
                    {isPollConfirmed ? <Check className="h-5 w-5" /> : "2"}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">Create Poll</p>
                    <p className="text-xs text-muted-foreground">
                      {cid ? `CID: ${cid.substring(0, 20)}...` : "Launch your poll on-chain"}
                    </p>
                  </div>
                  <Button
                    onClick={handleCreate}
                    disabled={
                      !isConnected ||
                      !isGroupOwner ||
                      !isOnBaseSepolia ||
                      !approvalSatisfied ||
                      !pollParams ||
                      !cid ||
                      !isStartTimeValid ||
                      isPollPending ||
                      isPollConfirming ||
                      isPollConfirmed ||
                      !!simulateCreatePollError
                    }
                    variant="neon"
                  >
                    {isPollPending || isPollConfirming ? "Creating..." : "Create Poll"}
                  </Button>
                  {!isStartTimeValid && (
                    <p className="text-sm text-red-500">
                      Start time must be in the future. Please adjust the start time.
                    </p>
                  )}
                </div>
              </div>

              {(approveHash || pollHash) && (
                <TransactionStatus
                  status={
                    isApprovePending || isApproveConfirming
                      ? "pending"
                      : approvalSatisfied && !!approveHash
                      ? "success"
                      : approveError
                      ? "error"
                      : "idle"
                  }
                  hash={approveHash}
                  error={approveError}
                />
              )}

              {pollHash && (
                <TransactionStatus
                  status={
                    isPollPending || isPollConfirming
                      ? "pending"
                      : isPollConfirmed
                      ? "success"
                      : pollError
                      ? "error"
                      : "idle"
                  }
                  hash={pollHash}
                  error={pollError}
                />
              )}

              {isPollConfirmed && (
                <Button className="w-full mt-4" onClick={() => navigate("/my-polls")}>
                  Go to My Polls
                </Button>
              )}

              <Button variant="ghost" onClick={() => setStep(2)} className="w-full" disabled={isBusy}>
                Back
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
