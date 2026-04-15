import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { WifiOff } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { createSession, sendMessage, getHistory } from '@/lib/api';
import { uploadFiles, validateFile, type PendingFile } from '@/lib/file-upload';
import { useEventStream, type AgentEvent } from '@/hooks/useEventStream';
import { MessageBubble, type Message, type MessageAttachment, type ToolUse } from './MessageBubble';
import { ChatInput, type ChatInputHandle } from './ChatInput';
import { TypingIndicator } from './TypingIndicator';
import { DropOverlay } from './DropOverlay';

type SessionStatus = 'idle' | 'running' | 'terminated' | null;

interface ChatPageProps {
  sessionId?: string;
  /** True when this session was just created — skip history loading, rely on SSE */
  fresh?: boolean;
}

let messageCounter = 0;
function nextId() {
  return `msg-${++messageCounter}-${Date.now()}`;
}

export function ChatPage({ sessionId: initialSessionId, fresh }: ChatPageProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const userInitials = user?.email ? user.email.slice(0, 2).toUpperCase() : 'U';

  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(
    initialSessionId ?? null,
  );
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentAgentMessageRef = useRef<string | null>(null);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  // Reset state when switching between sessions (same route, different params)
  useEffect(() => {
    setMessages([]);
    setSessionStatus(null);
    currentAgentMessageRef.current = null;
    setSessionId(initialSessionId ?? null);
  }, [initialSessionId]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sessionStatus]);

  // Handle SSE events
  //
  // IMPORTANT: Never mutate currentAgentMessageRef inside a setMessages
  // updater function. React StrictMode double-invokes updaters, and ref
  // mutations from the first invocation corrupt the second invocation's
  // logic. Pattern: set the ref BEFORE calling setMessages.
  const handleEvent = useCallback(
    (event: AgentEvent) => {
      switch (event.type) {
        // Handle user.message echo from SSE (needed after route remount
        // for fresh sessions where we skip history loading)
        case 'user.message': {
          const text =
            event.content
              ?.filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('') ?? '';
          if (!text) break;

          const eventId = event.id ?? nextId();
          setMessages((prev) => {
            // Don't add duplicate user messages
            if (prev.some((m) => m.role === 'user' && m.content === text)) {
              return prev;
            }
            return [...prev, { id: eventId, role: 'user' as const, content: text }];
          });
          break;
        }

        case 'agent.message': {
          const text =
            event.content
              ?.filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('') ?? '';

          let agentId = currentAgentMessageRef.current;
          if (!agentId) {
            agentId = nextId();
            currentAgentMessageRef.current = agentId;
          }
          const targetId = agentId;

          setMessages((prev) => {
            const existing = prev.find((m) => m.id === targetId);
            if (existing) {
              return prev.map((m) =>
                m.id === targetId ? { ...m, content: m.content + text } : m,
              );
            }
            return [
              ...prev,
              { id: targetId, role: 'agent' as const, content: text, toolUses: [] },
            ];
          });
          break;
        }

        case 'agent.tool_use':
        case 'agent.mcp_tool_use': {
          const toolUse: ToolUse = {
            id: event.id ?? nextId(),
            name: event.name ?? event.tool_name ?? 'unknown',
            input: event.input,
          };

          let agentId = currentAgentMessageRef.current;
          if (!agentId) {
            agentId = nextId();
            currentAgentMessageRef.current = agentId;
          }
          const targetId = agentId;

          setMessages((prev) => {
            const existing = prev.find((m) => m.id === targetId);
            if (existing) {
              return prev.map((m) =>
                m.id === targetId
                  ? { ...m, toolUses: [...(m.toolUses ?? []), toolUse] }
                  : m,
              );
            }
            return [
              ...prev,
              { id: targetId, role: 'agent' as const, content: '', toolUses: [toolUse] },
            ];
          });
          break;
        }

        case 'agent.tool_result':
        case 'agent.mcp_tool_result': {
          const targetId = currentAgentMessageRef.current;
          if (!targetId) break;

          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== targetId) return m;
              const tools = [...(m.toolUses ?? [])];
              if (tools.length > 0) {
                tools[tools.length - 1] = {
                  ...tools[tools.length - 1],
                  result: event.content,
                };
              }
              return { ...m, toolUses: tools };
            }),
          );
          break;
        }

        case 'session.status_running':
          setSessionStatus('running');
          break;

        case 'session.status_idle': {
          const stopReason = event.stop_reason?.type;
          if (stopReason === 'end_turn') {
            setSessionStatus('idle');
            currentAgentMessageRef.current = null;
          } else if (stopReason === 'requires_action') {
            setSessionStatus('idle');
            setMessages((prev) => [
              ...prev,
              {
                id: nextId(),
                role: 'system',
                content: 'The agent requires additional action to continue.',
              },
            ]);
          } else if (stopReason === 'retries_exhausted') {
            setSessionStatus('idle');
            setMessages((prev) => [
              ...prev,
              {
                id: nextId(),
                role: 'system',
                content: 'The agent encountered repeated errors and stopped.',
              },
            ]);
          } else {
            setSessionStatus('idle');
            currentAgentMessageRef.current = null;
          }
          break;
        }

        case 'session.status_terminated':
          setSessionStatus('terminated');
          currentAgentMessageRef.current = null;
          break;

        case 'session.error':
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: 'system',
              content: `Something went wrong: ${event.error ?? 'Unknown error'}`,
            },
          ]);
          break;

        default:
          break;
      }
    },
    [],
  );

  // SSE hook — must be called before effects that use connectTo
  const { connectionStatus, connectTo } = useEventStream(handleEvent);

  // Load history + connect SSE when resuming a session.
  // For fresh sessions (just created), skip history — SSE delivers everything
  // including the user.message echo.
  useEffect(() => {
    if (!initialSessionId) return;

    connectTo(initialSessionId);

    if (fresh) {
      // Fresh session: SSE stream will deliver user.message echo + agent response
      return;
    }

    getHistory(initialSessionId)
      .then((history) => {
        const restored: Message[] = [];
        let currentAgent: Message | null = null;

        for (const event of history) {
          if (event.type === 'user.message') {
            if (currentAgent) {
              restored.push(currentAgent);
              currentAgent = null;
            }
            const text =
              event.content
                ?.filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join('') ?? '';
            restored.push({
              id: event.id ?? nextId(),
              role: 'user',
              content: text,
            });
          } else if (event.type === 'agent.message') {
            if (!currentAgent) {
              currentAgent = {
                id: event.id ?? nextId(),
                role: 'agent',
                content: '',
                toolUses: [],
              };
            }
            const text =
              event.content
                ?.filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join('') ?? '';
            currentAgent.content += text;
          } else if (
            event.type === 'agent.tool_use' ||
            event.type === 'agent.mcp_tool_use'
          ) {
            if (!currentAgent) {
              currentAgent = {
                id: nextId(),
                role: 'agent',
                content: '',
                toolUses: [],
              };
            }
            currentAgent.toolUses!.push({
              id: event.id ?? nextId(),
              name: event.name ?? event.tool_name ?? 'unknown',
              input: event.input,
            });
          } else if (
            event.type === 'agent.tool_result' ||
            event.type === 'agent.mcp_tool_result'
          ) {
            if (currentAgent && currentAgent.toolUses!.length > 0) {
              const lastTool =
                currentAgent.toolUses![currentAgent.toolUses!.length - 1];
              lastTool.result = event.content;
            }
          }
        }
        if (currentAgent) {
          restored.push(currentAgent);
        }
        // Merge: if SSE already delivered an agent message, keep SSE state
        setMessages((prev) => {
          const hasAgent = prev.some((m) => m.role === 'agent');
          if (hasAgent) return prev;
          return restored;
        });
        setSessionStatus('idle');
      })
      .catch(() => {
        toast.error('Failed to load conversation history.');
      });
  }, [initialSessionId, connectTo, fresh]);

  // Drag-and-drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    const valid: File[] = [];
    for (const file of droppedFiles) {
      const error = validateFile(file, valid.length);
      if (error) {
        toast.error(error);
      } else {
        valid.push(file);
      }
    }

    if (valid.length > 0) {
      chatInputRef.current?.addFiles(valid);
    }
  }, []);

  async function handleSend(text: string, pendingFiles: PendingFile[]) {
    // Build local message with attachment previews
    const localAttachments: MessageAttachment[] = pendingFiles.map((pf) => ({
      fileName: pf.file.name,
      mimeType: pf.file.type,
      url: pf.previewUrl || '',
      size: pf.file.size,
    }));

    const userMsg: Message = {
      id: nextId(),
      role: 'user',
      content: text,
      attachments: localAttachments.length > 0 ? localAttachments : undefined,
    };
    setMessages((prev) => [...prev, userMsg]);
    currentAgentMessageRef.current = null;

    let sid = sessionId;
    if (!sid) {
      setIsCreatingSession(true);
      try {
        const { sessionId: newId } = await createSession();
        sid = newId;
        setSessionId(newId);

        await connectTo(newId);

        // Upload files if any
        let attachments;
        if (pendingFiles.length > 0) {
          try {
            attachments = await uploadFiles(pendingFiles, user!.id, newId);
          } catch (err) {
            toast.error(
              err instanceof Error ? err.message : 'File upload failed',
            );
            return;
          }
        }

        await sendMessage(newId, text, attachments);

        void navigate({
          to: '/chat/$sessionId',
          params: { sessionId: newId },
          search: { fresh: true },
          replace: true,
        });
      } catch {
        toast.error("Couldn't start a chat session. Try again.");
      }
      setIsCreatingSession(false);
      return;
    }

    try {
      let attachments;
      if (pendingFiles.length > 0) {
        try {
          attachments = await uploadFiles(pendingFiles, user!.id, sid);
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : 'File upload failed',
          );
          return;
        }
      }

      await sendMessage(sid, text, attachments);
    } catch {
      toast.error('Failed to send message. Try again.');
    }
  }

  const inputDisabled =
    sessionStatus === 'running' ||
    sessionStatus === 'terminated' ||
    isCreatingSession;

  return (
    <div
      className="flex flex-1 flex-col h-full relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDragging && <DropOverlay />}

      {connectionStatus === 'disconnected' && sessionId && (
        <div className="flex items-center justify-center gap-2 bg-destructive/10 border-b border-destructive/30 px-4 py-2 text-sm text-destructive">
          <WifiOff className="h-4 w-4" />
          Connection lost. Reconnecting...
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-6 space-y-6">
        {messages.length === 0 && !isCreatingSession && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            <p>Start a conversation with PodPlay.</p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            userInitials={userInitials}
          />
        ))}
        {(sessionStatus === 'running' || isCreatingSession) && <TypingIndicator />}
        {sessionStatus === 'terminated' && (
          <div className="max-w-[800px] mx-auto px-4">
            <div className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground text-center">
              Session ended.{' '}
              <a href="/" className="underline font-medium">
                Start a new chat
              </a>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <ChatInput ref={chatInputRef} onSend={handleSend} disabled={inputDisabled} />
    </div>
  );
}
