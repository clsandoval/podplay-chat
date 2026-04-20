import { useEffect, useRef, useReducer, useCallback, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { WifiOff } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { createSession, sendMessage, getHistory } from '@/lib/api';
import { useEventStream, type AgentEvent } from '@/hooks/useEventStream';
import { type Message } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { TypingIndicator } from './TypingIndicator';
import { MessageList } from './MessageList';
import { StreamingBubble } from './StreamingBubble';
import { chatReducer, initialState } from './chatReducer';
import { eventsToMessages } from './eventsToMessages';

interface ChatPageProps {
  sessionId?: string;
  fresh?: boolean;
}

let userMsgCounter = 0;
function nextUserId() {
  return `u-${++userMsgCounter}-${Date.now()}`;
}

export function ChatPage({ sessionId: initialSessionId, fresh }: ChatPageProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const userInitials = user?.email ? user.email.slice(0, 2).toUpperCase() : 'U';

  const [state, dispatch] = useReducer(chatReducer, initialState);
  const [sessionId, setSessionId] = useReducer(
    (_: string | null, next: string | null) => next,
    initialSessionId ?? null,
  );
  // Using useReducer for sessionId gives us a stable dispatcher — avoids a useState setter in deps.

  const [isCreatingSession, setIsCreatingSession] = useState(false);

  // Reset state when switching sessions
  useEffect(() => {
    dispatch({ kind: 'reset' });
    setSessionId(initialSessionId ?? null);
  }, [initialSessionId]);

  // Stable batched-events handler
  const handleEvents = useCallback((events: AgentEvent[]) => {
    dispatch({ kind: 'events', events });
  }, []);

  const { connectionStatus, connectTo, seedSeenIds } = useEventStream(handleEvents);

  // Load history + connect SSE when resuming a session
  useEffect(() => {
    if (!initialSessionId) return;

    if (fresh) {
      connectTo(initialSessionId);
      return;
    }

    getHistory(initialSessionId)
      .then((history: AgentEvent[]) => {
        const ids = history.map((e) => e.id).filter((x): x is string => !!x);
        seedSeenIds(ids);
        const restored = eventsToMessages(history);
        dispatch({ kind: 'restore', messages: restored });
        connectTo(initialSessionId);
      })
      .catch(() => {
        toast.error('Failed to load conversation history.');
        connectTo(initialSessionId);
      });
  }, [initialSessionId, connectTo, seedSeenIds, fresh]);

  // Stable handleSend via refs: reads latest state without rebuilding the callback
  const stateRef = useRef(state);
  stateRef.current = state;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const handleSend = useCallback(async (text: string) => {
    const userMsg: Message = { id: nextUserId(), role: 'user', content: text };
    dispatch({ kind: 'user_send', message: userMsg });

    let sid = sessionIdRef.current;
    if (!sid) {
      setIsCreatingSession(true);
      try {
        const { sessionId: newId } = await createSession();
        sid = newId;
        setSessionId(newId);

        await connectTo(newId);
        await sendMessage(newId, text);

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
      await sendMessage(sid, text);
    } catch {
      toast.error('Failed to send message. Try again.');
    }
  }, [connectTo, navigate]);

  const inputDisabled =
    state.sessionStatus === 'running' ||
    state.sessionStatus === 'terminated' ||
    isCreatingSession;

  return (
    <div className="flex flex-1 flex-col h-full">
      {connectionStatus === 'disconnected' && sessionId && (
        <div className="flex items-center justify-center gap-2 bg-destructive/10 border-b border-destructive/30 px-4 py-2 text-sm text-destructive">
          <WifiOff className="h-4 w-4" />
          Connection lost. Reconnecting...
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-6 space-y-6">
        {state.messages.length === 0 && !state.draft && !isCreatingSession && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            <p>Start a conversation with PodPlay.</p>
          </div>
        )}
        <MessageList messages={state.messages} userInitials={userInitials} />
        {state.draft && <StreamingBubble draft={state.draft} />}
        {state.sessionStatus === 'running' && !state.draft && <TypingIndicator />}
        {isCreatingSession && !state.draft && <TypingIndicator />}
        {state.sessionStatus === 'terminated' && (
          <div className="max-w-[800px] mx-auto px-4">
            <div className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground text-center">
              Session ended.{' '}
              <a href="/" className="underline font-medium">
                Start a new chat
              </a>
            </div>
          </div>
        )}
      </div>

      <ChatInput onSend={handleSend} disabled={inputDisabled} />
    </div>
  );
}
