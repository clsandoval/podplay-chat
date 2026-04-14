import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { WifiOff } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { createSession, sendMessage, getHistory } from '@/lib/api';
import { useEventStream, type AgentEvent } from '@/hooks/useEventStream';
import { MessageBubble, type Message, type ToolUse } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { TypingIndicator } from './TypingIndicator';

type SessionStatus = 'idle' | 'running' | 'terminated' | null;

interface ChatPageProps {
  sessionId?: string;
}

let messageCounter = 0;
function nextId() {
  return `msg-${++messageCounter}-${Date.now()}`;
}

export function ChatPage({ sessionId: initialSessionId }: ChatPageProps) {
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

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sessionStatus]);

  // Load history when resuming a session
  useEffect(() => {
    if (!initialSessionId) return;

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
        setMessages(restored);
        setSessionStatus('idle');
      })
      .catch(() => {
        toast.error('Failed to load conversation history.');
      });
  }, [initialSessionId]);

  // Handle SSE events
  const handleEvent = useCallback(
    (event: AgentEvent) => {
      switch (event.type) {
        case 'agent.message': {
          const text =
            event.content
              ?.filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('') ?? '';

          setMessages((prev) => {
            const agentId = currentAgentMessageRef.current;
            if (agentId) {
              return prev.map((m) =>
                m.id === agentId ? { ...m, content: m.content + text } : m,
              );
            }
            const newId = nextId();
            currentAgentMessageRef.current = newId;
            return [
              ...prev,
              { id: newId, role: 'agent' as const, content: text, toolUses: [] },
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

          setMessages((prev) => {
            const agentId = currentAgentMessageRef.current;
            if (agentId) {
              return prev.map((m) =>
                m.id === agentId
                  ? { ...m, toolUses: [...(m.toolUses ?? []), toolUse] }
                  : m,
              );
            }
            const newId = nextId();
            currentAgentMessageRef.current = newId;
            return [
              ...prev,
              { id: newId, role: 'agent' as const, content: '', toolUses: [toolUse] },
            ];
          });
          break;
        }

        case 'agent.tool_result':
        case 'agent.mcp_tool_result': {
          setMessages((prev) => {
            const agentId = currentAgentMessageRef.current;
            if (!agentId) return prev;
            return prev.map((m) => {
              if (m.id !== agentId) return m;
              const tools = [...(m.toolUses ?? [])];
              if (tools.length > 0) {
                tools[tools.length - 1] = {
                  ...tools[tools.length - 1],
                  result: event.content,
                };
              }
              return { ...m, toolUses: tools };
            });
          });
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

        // agent.thinking, span.* — ignore
        default:
          break;
      }
    },
    [],
  );

  const { connectionStatus } = useEventStream(sessionId, handleEvent);

  async function handleSend(text: string) {
    // Optimistically add user message
    const userMsg: Message = { id: nextId(), role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    currentAgentMessageRef.current = null;

    let sid = sessionId;
    if (!sid) {
      setIsCreatingSession(true);
      try {
        const { sessionId: newId } = await createSession();
        sid = newId;
        setSessionId(newId);
        // Navigate to the new session URL
        void navigate({
          to: '/chat/$sessionId',
          params: { sessionId: newId },
          replace: true,
        });
      } catch {
        toast.error("Couldn't start a chat session. Try again.");
        setIsCreatingSession(false);
        return;
      }
      setIsCreatingSession(false);
    }

    try {
      await sendMessage(sid, text);
    } catch {
      toast.error('Failed to send message. Try again.');
    }
  }

  const inputDisabled =
    sessionStatus === 'running' ||
    sessionStatus === 'terminated' ||
    isCreatingSession;

  return (
    <div className="flex flex-1 flex-col h-full">
      {/* Connection banner */}
      {connectionStatus === 'disconnected' && sessionId && (
        <div className="flex items-center justify-center gap-2 bg-destructive/10 border-b border-destructive/30 px-4 py-2 text-sm text-destructive">
          <WifiOff className="h-4 w-4" />
          Connection lost. Reconnecting...
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto py-6 space-y-6">
        {messages.length === 0 && (
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
        {sessionStatus === 'running' && <TypingIndicator />}
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

      {/* Input bar */}
      <ChatInput onSend={handleSend} disabled={inputDisabled} />
    </div>
  );
}
