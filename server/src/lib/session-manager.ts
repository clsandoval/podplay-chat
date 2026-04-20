import * as anthropic from './anthropic.js';

type EventCallback = (event: any) => void;

interface ManagedSession {
  sessionId: string;
  buffer: any[];           // Recent events for replay (last 200)
  subscribers: Set<EventCallback>;
  abortController: AbortController;
}

const MAX_BUFFER = 200;
const sessions = new Map<string, ManagedSession>();

/**
 * Parse SSE frames from raw chunks. Anthropic sends:
 *   event: message\n
 *   data: {"type":"agent.message",...}\n
 *   \n
 *
 * All events use `event: message` — the actual type is inside the JSON `type` field.
 * We split on double-newline (blank line = event boundary per SSE spec),
 * then extract the `data:` line from each frame.
 */
function parseSSEFrames(raw: string, partial: string): { events: any[]; remaining: string } {
  const combined = partial + raw;
  // SSE events are delimited by blank lines (\n\n)
  const frames = combined.split('\n\n');
  const remaining = frames.pop() ?? ''; // last element may be incomplete
  const events: any[] = [];

  for (const frame of frames) {
    if (!frame.trim()) continue;
    for (const line of frame.split('\n')) {
      if (line.startsWith('data: ')) {
        try {
          events.push(JSON.parse(line.slice(6)));
        } catch {
          // non-JSON data line, skip
        }
      }
    }
  }

  return { events, remaining };
}

async function openStream(managed: ManagedSession) {
  const url = anthropic.streamUrl(managed.sessionId);
  const headers = anthropic.streamHeaders();

  const res = await fetch(url, {
    headers,
    signal: managed.abortController.signal,
  });

  if (!res.ok || !res.body) {
    console.error(`Failed to open stream for ${managed.sessionId}: ${res.status}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let partial = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const { events, remaining } = parseSSEFrames(chunk, partial);
      partial = remaining;

      for (const event of events) {
        console.log(`[SM] ${managed.sessionId.slice(0,12)}.. event: ${event.type} (${managed.subscribers.size} subscribers, ${managed.buffer.length} buffered)`);

        // Buffer for replay
        managed.buffer.push(event);
        if (managed.buffer.length > MAX_BUFFER) {
          managed.buffer.shift();
        }

        // Fan out to all browser subscribers
        for (const cb of managed.subscribers) {
          try { cb(event); } catch { /* subscriber error, ignore */ }
        }
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      console.error(`Stream error for ${managed.sessionId}:`, err);
      // Attempt reconnection with history consolidation
      setTimeout(() => reconnect(managed), 2000);
    }
  }
}

async function reconnect(managed: ManagedSession) {
  if (managed.abortController.signal.aborted) return; // already disconnected

  const seenIds = new Set(managed.buffer.map((e) => e.id).filter(Boolean));

  try {
    // Fetch any events we missed during the gap
    const history = await anthropic.listEvents(managed.sessionId);
    for (const event of history.data) {
      if (event.id && !seenIds.has(event.id)) {
        managed.buffer.push(event);
        if (managed.buffer.length > MAX_BUFFER) managed.buffer.shift();
        for (const cb of managed.subscribers) {
          try { cb(event); } catch { /* ignore */ }
        }
      }
    }

    // Reopen the live stream
    openStream(managed);
  } catch (err) {
    console.error(`Reconnect failed for ${managed.sessionId}:`, err);
    setTimeout(() => reconnect(managed), 5000);
  }
}

export const sessionManager = {
  connect(sessionId: string) {
    if (sessions.has(sessionId)) return;

    const managed: ManagedSession = {
      sessionId,
      buffer: [],
      subscribers: new Set(),
      abortController: new AbortController(),
    };

    sessions.set(sessionId, managed);
    openStream(managed);
  },

  subscribe(sessionId: string, cb: EventCallback): { unsubscribe: () => void; replay: any[] } {
    const managed = sessions.get(sessionId);
    if (!managed) throw new Error(`No managed session for ${sessionId}`);

    managed.subscribers.add(cb);
    const replay = [...managed.buffer]; // snapshot for replay

    return {
      replay,
      unsubscribe: () => { managed.subscribers.delete(cb); },
    };
  },

  disconnect(sessionId: string) {
    const managed = sessions.get(sessionId);
    if (!managed) return;

    managed.abortController.abort();
    managed.subscribers.clear();
    sessions.delete(sessionId);
  },

  isConnected(sessionId: string): boolean {
    return sessions.has(sessionId);
  },
};
