interface VoteOption {
  label: string;
  votes: number;
  percentage: number;
}

interface VoteChartProps {
  options: VoteOption[];
  totalVotes: number;
  winnerIndex?: number;
}

export function VoteChart({ options, totalVotes, winnerIndex }: VoteChartProps) {
  return (
    <div className="space-y-4">
      {options.map((option, idx) => (
        <div key={idx} className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className={`font-medium ${idx === winnerIndex ? 'text-green-500' : ''}`}>
              {option.label}
              {idx === winnerIndex && ' 👑'}
            </span>
            <span className="text-muted-foreground">
              {option.votes} votes ({option.percentage.toFixed(1)}%)
            </span>
          </div>
          <div className="h-3 w-full bg-secondary rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                idx === winnerIndex ? 'bg-green-500' : 'bg-primary'
              }`}
              style={{ width: `${option.percentage}%` }}
            />
          </div>
        </div>
      ))}

      {totalVotes === 0 && (
        <div className="text-center text-muted-foreground py-4">No votes cast yet.</div>
      )}
    </div>
  );
}

