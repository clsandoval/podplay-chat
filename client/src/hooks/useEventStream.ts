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
 * Events are buffered and delivered once per animation frame via onEvents.
 */
export function useEventStream(
  onEvents: (events: AgentEvent[]) => void,
) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const onEventsRef = useRef(onEvents);
  onEventsRef.current = onEvents;
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('disconnected');
  const connectGenRef = useRef(0);

  const bufferRef = useRef<AgentEvent[]>([]);
  const rafRef = useRef<number | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());

  const cancelPending = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    bufferRef.current = [];
  }, []);

  const flush = useCallback(() => {
    rafRef.current = null;
    const batch = bufferRef.current;
    bufferRef.current = [];
    if (batch.length > 0) onEventsRef.current(batch);
  }, []);

  const schedule = useCallback((event: AgentEvent) => {
    if (event.id) {
      if (seenIdsRef.current.has(event.id)) return;
      seenIdsRef.current.add(event.id);
    }
    bufferRef.current.push(event);
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(flush);
    }
  }, [flush]);

  const close = useCallback(() => {
    connectGenRef.current++;
    cancelPending();
    if (eventSourceRef.current) {
      console.log('[SSE] Closing connection');
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setConnectionStatus('disconnected');
  }, [cancelPending]);

  const connectTo = useCallback(async (sid: string): Promise<void> => {
    close();
    // close() bumped the gen; reset seen set for the new session.
    seenIdsRef.current = new Set();

    const gen = connectGenRef.current;
    setConnectionStatus('connecting');
    console.log(`[SSE] Connecting to session ${sid}...`);

    const { data } = await supabase.auth.getSession();

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
          schedule(event);
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
  }, [close, schedule]);

  useEffect(() => {
    return () => close();
  }, [close]);

  /**
   * Seed dedupe from externally-known event IDs (e.g. events returned from
   * a history fetch). Call before connectTo so replayed events are filtered.
   */
  const seedSeenIds = useCallback((ids: Iterable<string>) => {
    for (const id of ids) seenIdsRef.current.add(id);
  }, []);

  return {
    connectionStatus,
    connectTo,
    close,
    seedSeenIds,
  };
}
