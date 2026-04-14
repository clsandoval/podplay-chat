import { Link } from '@tanstack/react-router';
import { MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SessionItem {
  sessionId: string;
  title: string | null;
  createdAt: string;
}

interface SessionListProps {
  sessions: SessionItem[];
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function SessionList({ sessions }: SessionListProps) {
  if (sessions.length === 0) return null;

  return (
    <div className="mt-1 space-y-0.5">
      {sessions.map((s) => (
        <Link
          key={s.sessionId}
          to="/chat/$sessionId"
          params={{ sessionId: s.sessionId }}
          className={cn(
            'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
            'hover:bg-accent hover:text-accent-foreground text-muted-foreground',
          )}
          activeProps={{
            className: 'bg-accent text-accent-foreground font-medium',
          }}
        >
          <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
          <span className="truncate flex-1 text-xs">
            {s.title ?? 'Untitled'}
          </span>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {timeAgo(s.createdAt)}
          </span>
        </Link>
      ))}
    </div>
  );
}
