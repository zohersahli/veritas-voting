import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/Card";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";
import { UserPlus } from "lucide-react";
import { useConnection, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { veritasCoreAbi, veritasCoreAddress } from "@/lib/veritas";
import { toast } from "@/hooks/useToast";
import { isAddress } from "viem";
import { CHAIN_IDS } from "@/config/contracts";

interface MemberListProps {
  groupId: bigint;
  isOwner: boolean;
  membershipType: number; // 0=Manual
}

export function MemberList({ groupId, isOwner, membershipType }: MemberListProps) {
  const [newMember, setNewMember] = useState("");

  const { isConnected, chainId } = useConnection();
  const isCorrectChain = chainId === CHAIN_IDS.baseSepolia;

  // wagmi v3: mutation object
  const write = useWriteContract();
  const hash = write.data;

  const receipt = useWaitForTransactionReceipt({
    hash,
    query: { enabled: Boolean(hash) },
  });

  const isConfirming = receipt.isLoading;
  const isPending = write.isPending;

  const canManageMembers = membershipType === 0 && isOwner;
  const canWrite = isConnected && isCorrectChain && canManageMembers && !isPending && !isConfirming;

  const helperText = useMemo(() => {
    if (membershipType !== 0) {
      return membershipType === 1 ? "NFT ownership" : "Claim Codes";
    }
    return null;
  }, [membershipType]);

  const handleAddMember = () => {
    const trimmed = newMember.trim();

    if (!isConnected) {
      toast.error("Connect your wallet first");
      return;
    }

    if (!isCorrectChain) {
      toast.error("Wrong network. Switch to Base Sepolia");
      return;
    }

    if (!isOwner) {
      toast.error("Only group owner can add members");
      return;
    }

    if (membershipType !== 0) {
      toast.error("This group is not manual");
      return;
    }

    if (!isAddress(trimmed)) {
      toast.error("Invalid address");
      return;
    }

    write.mutate(
      {
        chainId: CHAIN_IDS.baseSepolia,
        address: veritasCoreAddress,
        abi: veritasCoreAbi,
        functionName: "setManualMember",
        args: [groupId, trimmed as `0x${string}`, true],
      },
      {
        onSuccess: () => {
          toast.success("Transaction sent");
          setNewMember("");
        },
        onError: (err) => {
          toast.error(err?.message ?? "Transaction failed");
        },
      }
    );
  };

  if (membershipType !== 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground">
            Member list is managed automatically via {helperText}.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manage Members</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {!isConnected ? (
          <div className="text-sm text-muted-foreground">
            Connect your wallet to manage members.
          </div>
        ) : !isCorrectChain ? (
          <div className="text-sm text-muted-foreground">
            Wrong network. Switch to Base Sepolia.
          </div>
        ) : null}

        {isOwner ? (
          <div className="flex gap-2">
            <Input
              placeholder="0x..."
              value={newMember}
              onChange={(e) => setNewMember(e.target.value)}
            />
            <Button onClick={handleAddMember} disabled={!canWrite}>
              {isPending || isConfirming ? (
                "Adding..."
              ) : (
                <>
                  <UserPlus className="mr-2 h-4 w-4" /> Add
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            Only the group owner can add members.
          </div>
        )}

        <div className="text-sm text-muted-foreground">
          Note: For manual groups, member list is stored on-chain. Use a subgraph for full list display in production.
        </div>
      </CardContent>
    </Card>
  );
}
