import { memo } from 'react';
import { MessageBubble, type Message } from './MessageBubble';

interface MessageListProps {
  messages: Message[];
  userInitials: string;
}

function MessageListImpl({ messages, userInitials }: MessageListProps) {
  return (
    <>
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} userInitials={userInitials} />
      ))}
    </>
  );
}

export const MessageList = memo(MessageListImpl);
