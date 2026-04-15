import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Download } from 'lucide-react';
import { ToolUseSummary } from './ToolUseBlock';
import { FileAttachmentDisplay } from './FileAttachmentDisplay';
import { cn } from '@/lib/utils';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface DetectedFile {
  path: string;
  name: string;
}

function detectFilesInToolResults(toolUses?: ToolUse[]): DetectedFile[] {
  if (!toolUses) return [];
  const files: DetectedFile[] = [];

  for (const tool of toolUses) {
    if (tool.name === 'push_files' || tool.name === 'create_or_update_file') {
      if (tool.input?.files) {
        for (const f of tool.input.files) {
          if (f.path) {
            files.push({
              path: f.path,
              name: f.path.split('/').pop() || f.path,
            });
          }
        }
      }
      if (tool.input?.path) {
        files.push({
          path: tool.input.path,
          name: tool.input.path.split('/').pop() || tool.input.path,
        });
      }
    }
  }

  return files;
}

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
            <>
              {message.content && (
                <p className="whitespace-pre-wrap">{message.content}</p>
              )}
              {message.attachments && message.attachments.length > 0 && (
                <FileAttachmentDisplay
                  attachments={message.attachments}
                  isUser={true}
                />
              )}
            </>
          ) : (
            <div className="prose prose-sm max-w-none dark:prose-invert prose-p:leading-relaxed prose-pre:bg-background prose-pre:border prose-pre:rounded-md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* Agent file download links */}
        {!isUser && (() => {
          const detectedFiles = detectFilesInToolResults(message.toolUses);
          if (detectedFiles.length === 0) return null;
          return (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {detectedFiles.map((f) => (
                <a
                  key={f.path}
                  href={`${API_URL}/api/github/${f.path}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <Download className="h-3 w-3" />
                  <span className="truncate max-w-[160px]">{f.name}</span>
                </a>
              ))}
            </div>
          );
        })()}

        {/* Tool use summary — all calls collapsed into one line */}
        {message.toolUses && message.toolUses.length > 0 && (
          <ToolUseSummary tools={message.toolUses} />
        )}
      </div>
    </div>
  );
}
