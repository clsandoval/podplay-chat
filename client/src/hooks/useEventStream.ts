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

/**
 * SSE hook — caller is responsible for calling connectTo(sessionId).
 * No auto-connect: avoids duplicate connections from React StrictMode
 * and from racing with explicit connectTo calls in handleSend.
 */
export function useEventStream(
  onEvent: (event: AgentEvent) => void,
) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('disconnected');
  // Guards against concurrent async connectTo calls leaking EventSources
  const connectGenRef = useRef(0);

  const close = useCallback(() => {
    connectGenRef.current++;
    if (eventSourceRef.current) {
      console.log('[SSE] Closing connection');
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setConnectionStatus('disconnected');
  }, []);

  // Connect to a specific session — returns a promise that resolves when open
  const connectTo = useCallback(async (sid: string): Promise<void> => {
    close();

    const gen = connectGenRef.current;
    setConnectionStatus('connecting');
    console.log(`[SSE] Connecting to session ${sid}...`);

    const { data } = await supabase.auth.getSession();

    // Another connectTo was called while we awaited — bail out
    if (gen !== connectGenRef.current) {
      console.log('[SSE] Stale connect, aborting');
      return;
    }

    const token = data.session?.access_token;
    if (!token) {
      console.error('[SSE] No auth token available');
      setConnectionStatus('disconnected');
      return;
    }

    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    const url = `${apiUrl}/api/sessions/${sid}/stream?token=${encodeURIComponent(token)}`;

    return new Promise<void>((resolve) => {
      if (gen !== connectGenRef.current) { resolve(); return; }

      const es = new EventSource(url);

      es.onopen = () => {
        if (gen !== connectGenRef.current) { es.close(); resolve(); return; }
        console.log(`[SSE] Connected to session ${sid}`);
        setConnectionStatus('connected');
        resolve();
      };

      es.onmessage = (e) => {
        try {
          const event: AgentEvent = JSON.parse(e.data);
          console.log(`[SSE] ${event.type}`);
          onEventRef.current(event);
        } catch {
          // ignore non-JSON
        }
      };

      es.onerror = () => {
        if (gen !== connectGenRef.current) return;
        console.warn('[SSE] Connection error, auto-reconnecting...');
        setConnectionStatus('disconnected');
      };

      eventSourceRef.current = es;
    });
  }, [close]);

  // Clean up on unmount only
  useEffect(() => {
    return () => close();
  }, [close]);

  return {
    connectionStatus,
    connectTo,
    close,
  };
}
