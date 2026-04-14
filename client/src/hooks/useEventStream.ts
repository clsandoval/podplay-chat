import { useEffect, useRef, useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type AgentEvent = {
  type: string;
  id?: string;
  content?: any;
  tool_name?: string;
  name?: string;
  input?: any;
  stop_reason?: { type: string };
  [key: string]: any;
};

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export function useEventStream(
  sessionId: string | null,
  onEvent: (event: AgentEvent) => void,
) {
  const eventSourceRef = useRef<EventSource | null>(null);
  // Store onEvent in a ref to avoid reconnection churn when the callback
  // reference changes on re-render.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('disconnected');

  const connect = useCallback(async () => {
    if (!sessionId) return;

    setConnectionStatus('connecting');

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    const url = `${apiUrl}/api/sessions/${sessionId}/stream?token=${encodeURIComponent(token)}`;

    const es = new EventSource(url);

    es.onopen = () => {
      setConnectionStatus('connected');
    };

    // The proxy sends all events as `event: message`. EventSource.onmessage
    // handles events named "message", so this receives everything.
    es.onmessage = (e) => {
      try {
        const event: AgentEvent = JSON.parse(e.data);
        onEventRef.current(event);
      } catch {
        // ignore non-JSON messages
      }
    };

    es.onerror = () => {
      setConnectionStatus('disconnected');
      // EventSource auto-reconnects
    };

    eventSourceRef.current = es;
  }, [sessionId]); // onEvent excluded — accessed via ref

  useEffect(() => {
    connect();
    return () => {
      eventSourceRef.current?.close();
      setConnectionStatus('disconnected');
    };
  }, [connect]);

  return {
    connectionStatus,
    close: () => eventSourceRef.current?.close(),
  };
}
