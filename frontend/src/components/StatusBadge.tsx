import { Badge } from './ui/Badge';
import { PollStatus } from '@/lib/veritas';

interface StatusBadgeProps {
  status: PollStatus | number;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  switch (status) {
    case PollStatus.Upcoming:
      return <Badge variant="info" className={className}>Upcoming</Badge>;
    case PollStatus.Active:
      return <Badge variant="success" className={className}>Active</Badge>;
    case PollStatus.Ended:
      return <Badge variant="warning" className={className}>Ended</Badge>;
    case PollStatus.Finalized:
      return <Badge variant="secondary" className={className}>Finalized</Badge>;
    default:
      return <Badge variant="outline" className={className}>Unknown</Badge>;
  }
}

export function MembershipBadge({ isMember }: { isMember: boolean }) {
  return isMember ? <Badge variant="success">Member</Badge> : <Badge variant="outline">Not Member</Badge>;
}

