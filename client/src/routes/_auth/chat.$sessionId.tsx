import { createFileRoute } from '@tanstack/react-router';
import { ChatPage } from '@/components/chat/ChatPage';

type SearchParams = { fresh?: boolean };

export const Route = createFileRoute('/_auth/chat/$sessionId')({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    fresh: search.fresh === true || search.fresh === 'true',
  }),
  component: ChatSessionRoute,
});

function ChatSessionRoute() {
  const { sessionId } = Route.useParams();
  const { fresh } = Route.useSearch();
  return <ChatPage sessionId={sessionId} fresh={fresh} />;
}
