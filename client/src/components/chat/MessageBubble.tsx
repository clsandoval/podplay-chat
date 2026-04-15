import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ToolUseSummary } from './ToolUseBlock';
import { cn } from '@/lib/utils';

export interface ToolUse {
  id: string;
  name: string;
  input?: any;
  result?: any;
}

export interface MessageAttachment {
  fileName: string;
  mimeType: string;
  url: string;
  size: number;
}

export interface Message {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  toolUses?: ToolUse[];
  attachments?: MessageAttachment[];
}

interface MessageBubbleProps {
  message: Message;
  userInitials: string;
}

export function MessageBubble({ message, userInitials }: MessageBubbleProps) {
  if (message.role === 'system') {
    return (
      <div className="max-w-[800px] mx-auto px-4">
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {message.content}
        </div>
      </div>
    );
  }

  const isUser = message.role === 'user';

  return (
    <div
      className={cn(
        'flex items-start gap-3 max-w-[800px] mx-auto px-4',
        isUser && 'flex-row-reverse',
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold',
          isUser
            ? 'bg-muted text-foreground'
            : 'bg-foreground text-background',
        )}
      >
        {isUser ? userInitials : 'P'}
      </div>

      {/* Bubble */}
      <div
        className={cn(
          'min-w-0 max-w-[calc(100%-4rem)]',
          isUser && 'text-right',
        )}
      >
        <div
          className={cn(
            'inline-block rounded-lg px-4 py-2.5 text-sm',
            isUser
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted shadow-sm',
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="prose prose-sm max-w-none dark:prose-invert prose-p:leading-relaxed prose-pre:bg-background prose-pre:border prose-pre:rounded-md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* Tool use summary — all calls collapsed into one line */}
        {message.toolUses && message.toolUses.length > 0 && (
          <ToolUseSummary tools={message.toolUses} />
        )}
      </div>
    </div>
  );
}
