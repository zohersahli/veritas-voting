import { useMemo, useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useConnection, useSwitchChain } from 'wagmi';
import { veritasCoreAbi, veritasCoreAddress } from '@/lib/veritas';
import { CHAIN_IDS } from '@/config/contracts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TransactionStatus } from '@/components/TransactionStatus';
import { Skeleton } from '@/components/LoadingSkeleton';
import { shortenAddress } from '@/utils/format';
import { isAddress, zeroAddress } from 'viem';
import { ArrowLeft, UserCheck, UserX } from 'lucide-react';
import { toast } from '@/hooks/useToast';

export function Delegation() {
  const { pollId } = useParams();

  const { address, status, chainId } = useConnection();
  const isConnected = status === 'connected';

  const switchChain = useSwitchChain();
  const isOnBaseSepolia = chainId === CHAIN_IDS.baseSepolia;

  const queryClient = useQueryClient();

  const { id, hasValidPollId } = useMemo(() => {
    try {
      if (typeof pollId !== 'string' || pollId.length === 0) return { id: 0n, hasValidPollId: false };
      return { id: BigInt(pollId), hasValidPollId: true };
    } catch {
      return { id: 0n, hasValidPollId: false };
    }
  }, [pollId]);

  const voter = (isConnected ? address : zeroAddress) as `0x${string}`;
  const [delegateAddressInput, setDelegateAddress] = useState('');

  const canRead = hasValidPollId && isConnected;

  // Read poll to get groupId
  const { data: poll } = useReadContract({
    address: veritasCoreAddress,
    abi: veritasCoreAbi,
    functionName: 'getPoll',
    args: [id],
    query: { enabled: hasValidPollId },
  });

  const pollGroupId = useMemo(() => {
    if (!poll) return undefined;
    const pollData = poll as unknown as { groupId?: bigint };
    return pollData?.groupId;
  }, [poll]);

  // Prepare delegate address safely
  const delegateAddress = isAddress(delegateAddressInput) ? (delegateAddressInput as `0x${string}`) : undefined;

  // Reads
  const { data: currentDelegate, isLoading: isDelegateLoading } = useReadContract({
    address: veritasCoreAddress,
    abi: veritasCoreAbi,
    functionName: 'delegateOf',
    args: [id, voter],
    query: { enabled: canRead },
  });

  const { data: delegatorsCount } = useReadContract({
    address: veritasCoreAddress,
    abi: veritasCoreAbi,
    functionName: 'delegatedToCount',
    args: [id, voter],
    query: { enabled: canRead },
  });

  const { data: hasVoted } = useReadContract({
    address: veritasCoreAddress,
    abi: veritasCoreAbi,
    functionName: 'hasVoted',
    args: [id, voter],
    query: { enabled: canRead },
  });

  // AR: Pre-check membership to avoid showing actions that will revert.
  // EN: Pre-check membership to avoid showing actions that will revert.
  const { data: isDelegatorMember, isLoading: isDelegatorMemberLoading } = useReadContract({
    address: veritasCoreAddress,
    abi: veritasCoreAbi,
    functionName: 'isMember',
    args: [pollGroupId ?? 0n, address ?? zeroAddress],
    query: { enabled: Boolean(pollGroupId) && Boolean(address) },
  });

  const { data: isDelegateMember, isLoading: isDelegateMemberLoading } = useReadContract({
    address: veritasCoreAddress,
    abi: veritasCoreAbi,
    functionName: 'isMember',
    args: [pollGroupId ?? 0n, delegateAddress ?? zeroAddress],
    query: { enabled: Boolean(pollGroupId) && Boolean(delegateAddress) },
  });

  const delegatorOk = isDelegatorMember === true;
  const delegateOk = isDelegateMember === true;

  // Writes
  const delegateWrite = useWriteContract();
  const revokeWrite = useWriteContract();

  const delegateHash = delegateWrite.data;
  const revokeHash = revokeWrite.data;

  const isDelegatePending = delegateWrite.isPending;
  const isRevokePending = revokeWrite.isPending;

  const { isLoading: isDelegateConfirming, isSuccess: isDelegateSuccess } = useWaitForTransactionReceipt({
    hash: delegateHash,
    query: { enabled: Boolean(delegateHash) },
  });
  const { isLoading: isRevokeConfirming, isSuccess: isRevokeSuccess } = useWaitForTransactionReceipt({
    hash: revokeHash,
    query: { enabled: Boolean(revokeHash) },
  });

  useEffect(() => {
    if (!isDelegateSuccess) return;
    queryClient.invalidateQueries();
  }, [isDelegateSuccess, queryClient]);

  useEffect(() => {
    if (!isRevokeSuccess) return;
    queryClient.invalidateQueries();
  }, [isRevokeSuccess, queryClient]);

  const isUiLocked = isDelegatePending || isDelegateConfirming || isRevokePending || isRevokeConfirming;

  // Safe derived values for JSX
  const currentDelegateAddr = (currentDelegate as `0x${string}` | undefined) ?? zeroAddress;
  const hasVotedBool = canRead ? Boolean(hasVoted as boolean | undefined) : false;
  const hasDelegated = canRead ? currentDelegateAddr !== zeroAddress : false;
  const delegatorCount = canRead && delegatorsCount ? Number(delegatorsCount) : 0;

  const handleDelegate = () => {
    if (!isConnected) return;

    if (!isOnBaseSepolia) {
      switchChain.mutate({ chainId: CHAIN_IDS.baseSepolia });
      return;
    }

    if (!address) {
      toast.error('Connect your wallet first');
      return;
    }
    if (!hasValidPollId) {
      toast.error('Missing or invalid poll id');
      return;
    }
    if (isUiLocked) return;

    if (!delegateAddress) {
      toast.error('Invalid address');
      return;
    }
    if (delegateAddress.toLowerCase() === address.toLowerCase()) {
      toast.error('Cannot delegate to yourself');
      return;
    }
    if (hasVotedBool) {
      toast.error('You already voted in this poll');
      return;
    }
    if (!delegatorOk) {
      toast.error('You are not a member of this group');
      return;
    }
    if (!delegateOk) {
      toast.error('Delegate must be a member of the same group');
      return;
    }

    delegateWrite.mutate({
      address: veritasCoreAddress,
      abi: veritasCoreAbi,
      functionName: 'delegate',
      args: [id, delegateAddress],
    });
  };

  const handleRevoke = () => {
    if (!isConnected) return;

    if (!isOnBaseSepolia) {
      switchChain.mutate({ chainId: CHAIN_IDS.baseSepolia });
      return;
    }
    if (!hasValidPollId) {
      toast.error('Missing or invalid poll id');
      return;
    }
    if (isUiLocked) return;
    if (hasVotedBool) {
      toast.error('You already voted in this poll');
      return;
    }

    revokeWrite.mutate({
      address: veritasCoreAddress,
      abi: veritasCoreAbi,
      functionName: 'revoke',
      args: [id],
    });
  };

  // Returns (after hooks)
  if (!hasValidPollId) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/polls">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Vote Delegation</h1>
            <p className="text-muted-foreground">Missing or invalid poll id</p>
          </div>
        </div>
      </div>
    );
  }

  if (canRead && isDelegateLoading) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to={`/polls/${pollId}`}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Vote Delegation</h1>
          <p className="text-muted-foreground">Delegate your voting power to another address</p>
        </div>
      </div>

      {!isConnected && (
        <div className="bg-secondary/20 border border-border rounded-lg p-4">
          <p className="font-medium">Connect Wallet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Please connect your wallet to view and manage delegation for this poll.
          </p>
        </div>
      )}

      {isConnected && hasVotedBool && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 flex items-start gap-3">
          <UserX className="h-5 w-5 text-yellow-500 mt-0.5" />
          <div>
            <p className="font-medium text-yellow-500">Cannot Delegate After Voting</p>
            <p className="text-sm text-muted-foreground mt-1">
              You have already voted in this poll. Delegation is not available after casting your vote.
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Current Delegation Status</CardTitle>
          <CardDescription>Your voting power delegation for this poll</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-secondary/20 rounded-lg">
            <div>
              <p className="text-sm text-muted-foreground">Delegated To</p>
              <p className="font-mono font-medium">
                {isConnected ? (hasDelegated ? shortenAddress(currentDelegateAddr) : 'Not delegated') : 'Connect wallet'}
              </p>
            </div>

            {isConnected && hasDelegated && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleRevoke}
                disabled={isUiLocked || hasVotedBool}
              >
                <UserX className="mr-2 h-4 w-4" />
                Revoke
              </Button>
            )}
          </div>

          <div className="flex items-center justify-between p-4 bg-secondary/20 rounded-lg">
            <div>
              <p className="text-sm text-muted-foreground">Delegators</p>
              <p className="font-medium">
                {isConnected ? `${delegatorCount} addresses delegating to you` : 'Connect wallet'}
              </p>
            </div>

            {isConnected && delegatorCount > 0 && (
              <div className="text-sm text-muted-foreground">
                Vote weight: 1 + {delegatorCount} = {1 + delegatorCount}
              </div>
            )}
          </div>

          <TransactionStatus
            status={isRevokePending || isRevokeConfirming ? 'pending' : isRevokeSuccess ? 'success' : 'idle'}
            hash={revokeHash}
          />
        </CardContent>
      </Card>

      {isConnected && !hasDelegated && !hasVotedBool && (
        <Card>
          <CardHeader>
            <CardTitle>Delegate Your Vote</CardTitle>
            <CardDescription>Transfer your voting power to another address. They will vote on your behalf.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Input
                label="Delegate Address"
                placeholder="0x..."
                value={delegateAddressInput}
                onChange={(e) => setDelegateAddress(e.target.value)}
                disabled={isUiLocked}
                error={delegateAddressInput && !isAddress(delegateAddressInput) ? 'Invalid address' : undefined}
              />
              <p className="text-xs text-muted-foreground">
                Enter the Ethereum address you want to delegate your voting power to.
              </p>
            </div>

            {address && !isDelegatorMemberLoading && !delegatorOk ? (
              <div className="p-3 rounded-md border text-sm bg-yellow-500/10 border-yellow-500/20 text-yellow-500">
                You are not a member of this group, so you cannot delegate.
              </div>
            ) : null}

            {delegateAddressInput && !delegateAddress ? (
              <div className="p-3 rounded-md border text-sm bg-red-500/10 border-red-500/20 text-red-500">
                Invalid delegate address.
              </div>
            ) : null}

            {delegateAddress && !isDelegateMemberLoading && !delegateOk ? (
              <div className="p-3 rounded-md border text-sm bg-yellow-500/10 border-yellow-500/20 text-yellow-500">
                Delegate must be a member of the same group.
              </div>
            ) : null}

            <Button
              className="w-full"
              size="lg"
              onClick={handleDelegate}
              disabled={
                !delegateAddress ||
                isUiLocked ||
                !delegatorOk ||
                !delegateOk ||
                isDelegatorMemberLoading ||
                isDelegateMemberLoading
              }
              isLoading={isUiLocked && (isDelegatePending || isDelegateConfirming)}
            >
              <UserCheck className="mr-2 h-5 w-5" />
              Delegate Vote
            </Button>

            <TransactionStatus
              status={isDelegatePending || isDelegateConfirming ? 'pending' : isDelegateSuccess ? 'success' : 'idle'}
              hash={delegateHash}
            />
          </CardContent>
        </Card>
      )}

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-6">
          <h3 className="font-semibold mb-2">How Delegation Works</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>• You can delegate your voting power to any address</li>
            <li>• The delegate will vote with your combined voting weight</li>
            <li>• You can revoke delegation at any time before the poll ends</li>
            <li>• You cannot delegate after you have already voted</li>
            <li>• Multiple addresses can delegate to the same person</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
