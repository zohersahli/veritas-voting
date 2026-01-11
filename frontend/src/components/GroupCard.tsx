import { Link } from 'react-router-dom';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from './ui/Card';
import { Button } from './ui/Button';
import { Users, ArrowRight } from 'lucide-react';
import { Badge } from './ui/Badge';

interface GroupCardProps {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  membershipType: number;
  isMember?: boolean;
}

export function GroupCard({
  id,
  name,
  description,
  memberCount,
  membershipType,
  isMember
}: GroupCardProps) {
  const getMembershipLabel = (type: number) => {
    switch (type) {
      case 0: return 'Manual';
      case 1: return 'NFT';
      case 2: return 'Code';
      default: return 'Unknown';
    }
  };

  return (
    <Card className="flex flex-col h-full hover:border-primary/50 transition-colors">
      <CardHeader>
        <div className="flex justify-between items-start">
          <CardTitle className="line-clamp-1">{name}</CardTitle>
          {isMember && <Badge variant="success">Member</Badge>}
        </div>
        <CardDescription className="line-clamp-2 h-10">
          {description || 'No description provided.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <Users className="h-4 w-4" />
            <span>{memberCount} members</span>
          </div>
          <Badge variant="secondary" className="text-xs text-white">
            {getMembershipLabel(membershipType)}
          </Badge>
          <Badge variant="outline" className="text-xs">
            ID: {id}
          </Badge>
        </div>
      </CardContent>
      <CardFooter>
        <Button asChild className="w-full" variant="outline">
          <Link to={`/groups/${id}`}>
            View Group <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

