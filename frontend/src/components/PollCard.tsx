import { Link } from "react-router-dom";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "./ui/Card";
import { Button } from "./ui/Button";
import { StatusBadge } from "./StatusBadge";
import { Clock, BarChart2 } from "lucide-react";
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
}

export function PollCard({
  id,
  title,
  status,
  endTime,
  voteCount,
  hasVoted,
}: PollCardProps) {
  const pollId = typeof id === "bigint" ? id.toString() : String(id);
  const endTimeNumber = typeof endTime === "bigint" ? Number(endTime) : endTime;
  const canVote = status === PollStatus.Active && hasVoted !== true;

  return (
    <Card className="flex flex-col h-full hover:border-primary/50 transition-colors">
      <CardHeader>
        <div className="flex justify-between items-start mb-2">
          <StatusBadge status={status} />
          {hasVoted ? <span className="text-xs font-medium text-green-500">Voted</span> : null}
        </div>
        <CardTitle className="line-clamp-2 leading-tight">{title}</CardTitle>
      </CardHeader>

      <CardContent className="flex-1 space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" />
          <span>Ends {formatDate(endTimeNumber)}</span>
        </div>

        {typeof voteCount === "number" ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <BarChart2 className="h-4 w-4" />
            <span>{voteCount} votes cast</span>
          </div>
        ) : null}
      </CardContent>

      <CardFooter>
        <Button
          asChild
          className="w-full"
          variant={canVote ? "neon" : "secondary"}
        >
          <Link to={`/polls/${pollId}`}>
            {canVote ? "Vote Now" : status === PollStatus.Active ? "View Poll" : "View Results"}
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
