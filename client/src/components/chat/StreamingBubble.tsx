import { MessageBubble, type Message } from './MessageBubble';
import type { Draft } from './chatReducer';

interface StreamingBubbleProps {
  draft: Draft;
}

function draftToMessage(draft: Draft): Message {
  return {
    id: draft.id,
    role: 'agent',
    content: draft.content,
    toolUses: draft.toolUses,
  };
}

export function StreamingBubble({ draft }: StreamingBubbleProps) {
  return <MessageBubble message={draftToMessage(draft)} userInitials="" />;
}
