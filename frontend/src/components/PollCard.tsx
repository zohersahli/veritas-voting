import { Link } from "react-router-dom";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "./ui/Card";
import { Button } from "./ui/Button";
import { StatusBadge } from "./StatusBadge";
import { Clock, BarChart2, Users } from "lucide-react";
import { formatDate } from "@/utils/format";
import { PollStatus } from "@/lib/veritas";

type IdLike = string | number | bigint;

interface PollCardProps {
  id: IdLike;
  title: string;
  status: PollStatus;
  endTime: number | bigint;
  voteCount?: number;
  hasVoted?: boolean;
  groupId?: IdLike;
  startTime?: number | bigint;
  nowSec?: number;
}

function toSec(x: number | bigint | undefined): number | null {
  if (x === undefined) return null;
  const n = typeof x === "bigint" ? Number(x) : x;
  return Number.isFinite(n) ? n : null;
}

function formatTimeRemaining(nowSec: number, targetSec: number): string {
  const diff = targetSec - nowSec;
  if (diff <= 0) return "0m";

  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export function PollCard({
  id,
  title,
  status,
  startTime,
  endTime,
  voteCount,
  hasVoted,
  groupId,
  nowSec,
}: PollCardProps) {
  const pollId = typeof id === "bigint" ? id.toString() : String(id);

  const startSec = toSec(startTime);
  const endSec = toSec(endTime);

  const canVote = status === PollStatus.Active && hasVoted !== true;

  const groupIdStr =
    groupId !== undefined
      ? typeof groupId === "bigint"
        ? groupId.toString()
        : String(groupId)
      : null;

  // Decide which timestamp to display and what label to use
  let timeLabel: "Starts" | "Ends" | "Ended" = "Ends";
  let timeValueSec: number | null = endSec;

  if (status === PollStatus.Upcoming) {
    timeLabel = "Starts";
    timeValueSec = startSec ?? endSec;
  } else if (status === PollStatus.Ended || status === PollStatus.Finalized) {
    timeLabel = "Ended";
    timeValueSec = endSec;
  } else {
    // Active
    timeLabel = "Ends";
    timeValueSec = endSec;
  }

  const showRemaining =
    typeof nowSec === "number" &&
    timeValueSec !== null &&
    (status === PollStatus.Upcoming || status === PollStatus.Active);

  const remainingText =
    showRemaining && timeValueSec !== null
      ? formatTimeRemaining(nowSec as number, timeValueSec)
      : null;

  const displayDate = formatDate(timeValueSec ?? (typeof endTime === "bigint" ? Number(endTime) : endTime));

  return (
    <Card className="flex flex-col h-full hover:border-primary/50 transition-colors">
      <CardHeader>
        <div className="flex justify-between items-start mb-2">
          <StatusBadge status={status} />
          {hasVoted ? <span className="text-xs font-medium text-green-500">Voted</span> : null}
        </div>

        <CardTitle className="line-clamp-2 leading-tight">{title}</CardTitle>

        {groupIdStr ? (
          <div className="mt-2">
            <Button asChild variant="outline" size="sm" className="h-7 px-2">
              <Link to={`/groups/${groupIdStr}`} className="flex items-center gap-2">
                <Users className="h-3.5 w-3.5" />
                <span className="text-xs">Group {groupIdStr}</span>
              </Link>
            </Button>
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="flex-1 space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" />
          <span>
            {timeLabel} {displayDate}
            {remainingText ? ` (in ${remainingText})` : ""}
          </span>
        </div>

        {typeof voteCount === "number" ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <BarChart2 className="h-4 w-4" />
            <span>{voteCount} votes cast</span>
          </div>
        ) : null}
      </CardContent>

      <CardFooter>
        <Button asChild className="w-full" variant={canVote ? "neon" : "secondary"}>
          <Link to={`/polls/${pollId}`}>
            {canVote ? "Vote Now" : status === PollStatus.Active ? "View Poll" : "View Results"}
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
