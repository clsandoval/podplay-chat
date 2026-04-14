import { createFileRoute } from '@tanstack/react-router';
import { ChatPage } from '@/components/chat/ChatPage';

export const Route = createFileRoute('/_auth/chat/$sessionId')({
  component: ChatSessionRoute,
});

function ChatSessionRoute() {
  const { sessionId } = Route.useParams();
  return <ChatPage sessionId={sessionId} />;
}
