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
import { toast } from "@/hooks/useToast";

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
  const [durationValue, setDurationValue] = useState(3);
  const [durationUnit, setDurationUnit] = useState<"minutes" | "hours" | "days">("days");
  const [useQuorum, setUseQuorum] = useState(false);
  const [quorumPercent, setQuorumPercent] = useState(10); // 10% (stored as percentage 0-100)
  const [cid, setCid] = useState<string>("");
  const [isGeneratingCid, setIsGeneratingCid] = useState(false);

  const START_TIME_BUFFER_SECONDS = 120;
  const MAX_DURATION_DAYS = 30; // keep same upper cap as before (30 days), but allow minutes/hours

  const { address, status, chainId } = useConnection();
  const isConnected = status === "connected";
  const connectedAddress = (isConnected ? address : zeroAddress) as `0x${string}`;

  const { switchChainAsync } = useSwitchChain();
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
    chainId: CHAIN_IDS.baseSepolia,
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

  // Read eligible count for quorum (includes owner)
  const { data: eligibleCountData } = useReadContract({
    chainId: CHAIN_IDS.baseSepolia,
    address: veritasCoreAddress,
    abi: veritasCoreAbi,
    functionName: "getEligibleCountForQuorum",
    args: [groupIdBn ?? 0n],
    query: { enabled: Boolean(groupIdBn) && useQuorum },
  });

  const eligibleCount = eligibleCountData != null ? BigInt(eligibleCountData) : null;

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
    chainId: CHAIN_IDS.baseSepolia,
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
    chainId: CHAIN_IDS.baseSepolia,
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
    chainId: CHAIN_IDS.baseSepolia,
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
      chainId: CHAIN_IDS.baseSepolia,
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

    const unitSeconds =
      durationUnit === "minutes" ? 60 : durationUnit === "hours" ? 60 * 60 : 24 * 60 * 60;
    const maxSeconds = MAX_DURATION_DAYS * 24 * 60 * 60;
    const rawSeconds = Math.floor(durationValue * unitSeconds);
    const durationSeconds = Math.min(Math.max(rawSeconds, 60), maxSeconds); // min 1 minute, max 30 days

    const endTime = BigInt(startTimeWithBuffer + durationSeconds);

    // AR: Convert percentage (0-100) to BPS (0-10000) for contract
    // EN: Convert percentage (0-100) to BPS (0-10000) for contract
    // Contract validation: if quorumEnabled=true, quorumBps must be > 0 and <= 10000
    const quorumBpsFinal = useQuorum ? Math.round(quorumPercent * 100) : 0;

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
  }, [groupIdBn, title, cid, options, durationValue, durationUnit, useQuorum, quorumPercent]);

  const now = Math.floor(Date.now() / 1000);
  const isStartTimeValid = pollParams ? Number(pollParams.startTime) >= now + 30 : false;

  // Simulate createPoll (only owner, params ready + approval satisfied)
  const { data: simulateCreatePoll, error: simulateCreatePollError } = useSimulateContract({
    chainId: CHAIN_IDS.baseSepolia,
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
      chainId: CHAIN_IDS.baseSepolia,
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

  const ensureBaseSepolia = async (): Promise<boolean> => {
    if (isOnBaseSepolia) return true;

    try {
      await switchChainAsync({ chainId: CHAIN_IDS.baseSepolia });
      return true;
    } catch (err) {
      console.error("Switch chain failed:", err);
      toast.error("Network switch was cancelled or failed");
      return false;
    }
  };

  const handleApprove = async () => {
    if (!isConnected) return;
    if (!isGroupOwner) return;

    const ok = await ensureBaseSepolia();
    if (!ok) return;

    if (simulateApproveError) {
      console.error("Approve simulation failed:", simulateApproveError);
      toast.error("Approve simulation failed");
      return;
    }
    if (!simulateApprove) return;

    approveWrite.mutate({
      chainId: CHAIN_IDS.baseSepolia,
      address: linkTokenAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [veritasCoreAddress, requiredApproval],
    });
  };

  const handleCreate = async () => {
    if (!isConnected) return;
    if (!isGroupOwner) return;

    const ok = await ensureBaseSepolia();
    if (!ok) return;

    if (!approvalSatisfied) return;
    if (!pollParams) return;

    if (simulateCreatePollError) {
      console.error("Create poll simulation failed:", simulateCreatePollError);
      toast.error("Create poll simulation failed");
      return;
    }
    if (!simulateCreatePoll) return;

    createPollWrite.mutate({
      chainId: CHAIN_IDS.baseSepolia,
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
            <div className="text-sm">Only the group owner can create polls for this group.</div>
            <div className="text-xs text-muted-foreground">
              Group Owner: {groupOwner.slice(0, 6)}...{groupOwner.slice(-4)}
            </div>
            <div className="text-xs text-muted-foreground">
              Your Address: {connectedAddress.slice(0, 6)}...{connectedAddress.slice(-4)}
            </div>
            <Button type="button" variant="neon" onClick={() => navigate(`/groups/${groupIdBn.toString()}`)}>
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
                error={groupId.length > 0 && groupIdBn === null ? "Group ID must be a valid number" : undefined}
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
                <label className="text-sm font-medium">Voting Duration</label>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Input
                      label="Value"
                      value={String(durationValue)}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n)) return;
                        setDurationValue(Math.max(1, Math.floor(n)));
                      }}
                      placeholder="e.g. 90"
                      disabled={isBusy}
                    />
                  </div>
                  <div className="w-40">
                    <label className="text-sm font-medium">Unit</label>
                    <select
                      className="mt-2 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                      value={durationUnit}
                      onChange={(e) => setDurationUnit(e.target.value as "minutes" | "hours" | "days")}
                      disabled={isBusy}
                    >
                      <option value="minutes">Minutes</option>
                      <option value="hours">Hours</option>
                      <option value="days">Days</option>
                    </select>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Min: 1 minute. Max: 30 days (same cap as before, but you can pick minutes/hours).
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Quorum Settings</label>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="useQuorum"
                    checked={useQuorum}
                    onChange={(e) => {
                      setUseQuorum(e.target.checked);
                      if (!e.target.checked) {
                        setQuorumPercent(0);
                      } else if (quorumPercent === 0) {
                        setQuorumPercent(10); // Default to 10% if enabling
                      }
                    }}
                    disabled={isBusy}
                    className="h-4 w-4 rounded border-input"
                  />
                  <label htmlFor="useQuorum" className="text-sm cursor-pointer">
                    Enable Quorum (minimum participation requirement)
                  </label>
                </div>

                {useQuorum && (
                  <div className="space-y-2 pl-6">
                    <Input
                      label="Quorum (%)"
                      value={quorumPercent}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (!Number.isFinite(val)) return;
                        // Allow 0.01% to 100% (0.01 to 100)
                        const clamped = Math.max(0.01, Math.min(100, val));
                        setQuorumPercent(clamped);
                      }}
                      type="number"
                      step={0.01}
                      min={0.01}
                      max={100}
                      placeholder="e.g. 10 (means 10%)"
                      disabled={isBusy}
                      error={
                        quorumPercent < 0.01 || quorumPercent > 100
                          ? "Quorum must be between 0.01% and 100%"
                          : undefined
                      }
                    />
                    {eligibleCount != null && quorumPercent > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Eligible voters: {Number(eligibleCount)}. Required votes:{" "}
                        {Math.ceil((Number(eligibleCount) * quorumPercent) / 100)}
                      </p>
                    )}
                    {useQuorum && quorumPercent === 0 && (
                      <p className="text-xs text-red-500">
                        Quorum must be greater than 0% when quorum is enabled.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <Button className="w-full" onClick={() => setStep(2)} disabled={!groupIdBn || !title.trim() || isBusy}>
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
                      <Button variant="ghost" size="icon" onClick={() => handleRemoveOption(idx)} disabled={isBusy}>
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
                  <p className="text-red-500 text-sm font-medium">Only the group owner can create polls.</p>
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
                    <p className="text-yellow-500 text-sm">Failed to generate CID. Please check your description.</p>
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
                  chainId={CHAIN_IDS.baseSepolia}
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
                  chainId={CHAIN_IDS.baseSepolia}
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
