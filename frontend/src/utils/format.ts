import { formatEther } from 'viem';

export function shortenAddress(address: string | undefined | null): string {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatWeiToEth(wei: bigint | undefined | null): string {
  if (wei === undefined || wei === null) return '0';
  // Format to 4 decimal places max for display
  const eth = formatEther(wei);
  const [whole, fraction] = eth.split('.');
  if (!fraction) return whole;
  return `${whole}.${fraction.slice(0, 4)}`;
}

export function formatDate(timestamp: number | bigint | undefined): string {
  if (!timestamp) return '-';
  const date = new Date(Number(timestamp) * 1000);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: 'numeric'
  }).format(date);
}

export function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  return parts.join(' ') || '< 1m';
}

