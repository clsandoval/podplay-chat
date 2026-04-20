import { describe, it, expect } from 'vitest';
import { chatReducer, initialState } from './chatReducer';

describe('chatReducer', () => {
  describe('initial state', () => {
    it('has empty messages, null draft, null status, 0 pending sends', () => {
      expect(initialState).toEqual({
        messages: [],
        draft: null,
        sessionStatus: null,
        pendingSends: 0,
      });
    });
  });

  describe('reset action', () => {
    it('returns the initial state', () => {
      const dirty = {
        messages: [{ id: 'a', role: 'user' as const, content: 'hi' }],
        draft: { id: 'd', content: 'x', toolUses: [] },
        sessionStatus: 'running' as const,
        pendingSends: 2,
      };
      expect(chatReducer(dirty, { kind: 'reset' })).toEqual(initialState);
    });
  });

  describe('user_send action', () => {
    it('appends message, increments pendingSends, clears draft', () => {
      const start = {
        ...initialState,
        draft: { id: 'draft-1', content: 'partial', toolUses: [] },
        pendingSends: 0,
      };
      const msg = { id: 'u1', role: 'user' as const, content: 'hello' };
      const next = chatReducer(start, { kind: 'user_send', message: msg });
      expect(next.messages).toEqual([msg]);
      expect(next.draft).toBeNull();
      expect(next.pendingSends).toBe(1);
    });

    it('increments pendingSends cumulatively', () => {
      let s = { ...initialState, pendingSends: 3 };
      s = chatReducer(s, {
        kind: 'user_send',
        message: { id: 'u1', role: 'user', content: 'a' },
      });
      expect(s.pendingSends).toBe(4);
    });
  });

  describe('restore action', () => {
    it('replaces messages, nulls draft, resets pendingSends, sets idle', () => {
      const dirty = {
        messages: [{ id: 'old', role: 'user' as const, content: 'old' }],
        draft: { id: 'd', content: 'x', toolUses: [] },
        sessionStatus: 'running' as const,
        pendingSends: 2,
      };
      const restored = [
        { id: 'r1', role: 'user' as const, content: 'a' },
        { id: 'r2', role: 'agent' as const, content: 'b', toolUses: [] },
      ];
      const next = chatReducer(dirty, { kind: 'restore', messages: restored });
      expect(next.messages).toBe(restored);
      expect(next.draft).toBeNull();
      expect(next.pendingSends).toBe(0);
      expect(next.sessionStatus).toBe('idle');
    });
  });

  describe('events: user.message', () => {
    it('appends when no pending sends', () => {
      const evt = {
        type: 'user.message',
        id: 'e1',
        content: [{ type: 'text', text: 'hi' }],
      };
      const next = chatReducer(initialState, { kind: 'events', events: [evt] });
      expect(next.messages).toHaveLength(1);
      expect(next.messages[0].content).toBe('hi');
      expect(next.messages[0].role).toBe('user');
      expect(next.pendingSends).toBe(0);
    });

    it('decrements pendingSends and skips when echoing an optimistic send', () => {
      const start = { ...initialState, pendingSends: 2 };
      const evt = {
        type: 'user.message',
        id: 'e1',
        content: [{ type: 'text', text: 'hi' }],
      };
      const next = chatReducer(start, { kind: 'events', events: [evt] });
      expect(next.messages).toHaveLength(0);
      expect(next.pendingSends).toBe(1);
    });

    it('extracts text from text blocks only', () => {
      const evt = {
        type: 'user.message',
        id: 'e1',
        content: [
          { type: 'text', text: 'hello ' },
          { type: 'image', source: { data: 'abc' } },
          { type: 'text', text: 'world' },
        ],
      };
      const next = chatReducer(initialState, { kind: 'events', events: [evt] });
      expect(next.messages[0].content).toBe('hello world');
    });
  });

  describe('events: agent.message', () => {
    it('creates a draft on first agent.message', () => {
      const evt = {
        type: 'agent.message',
        id: 'e1',
        content: [{ type: 'text', text: 'Hello' }],
      };
      const next = chatReducer(initialState, { kind: 'events', events: [evt] });
      expect(next.draft).not.toBeNull();
      expect(next.draft!.content).toBe('Hello');
      expect(next.draft!.toolUses).toEqual([]);
      expect(next.messages).toEqual([]);
    });

    it('accumulates text from multiple agent.message events into the same draft', () => {
      const events = [
        { type: 'agent.message', id: 'e1', content: [{ type: 'text', text: 'Hel' }] },
        { type: 'agent.message', id: 'e2', content: [{ type: 'text', text: 'lo ' }] },
        { type: 'agent.message', id: 'e3', content: [{ type: 'text', text: 'world' }] },
      ];
      const next = chatReducer(initialState, { kind: 'events', events });
      expect(next.draft!.content).toBe('Hello world');
    });

    it('does not change messages array identity when only draft changes', () => {
      const start = {
        ...initialState,
        messages: [{ id: 'u1', role: 'user' as const, content: 'hi' }],
      };
      const evt = { type: 'agent.message', id: 'e1', content: [{ type: 'text', text: 'hey' }] };
      const next = chatReducer(start, { kind: 'events', events: [evt] });
      expect(next.messages).toBe(start.messages); // reference-identity preserved
    });
  });

  describe('events: tool_use / tool_result', () => {
    it('appends tool_use to draft.toolUses', () => {
      const evt = {
        type: 'agent.tool_use',
        id: 't1',
        name: 'search',
        input: { query: 'hello' },
      };
      const next = chatReducer(initialState, { kind: 'events', events: [evt] });
      expect(next.draft!.toolUses).toHaveLength(1);
      expect(next.draft!.toolUses[0]).toEqual({
        id: 't1',
        name: 'search',
        input: { query: 'hello' },
      });
    });

    it('handles mcp_tool_use the same as tool_use', () => {
      const evt = {
        type: 'agent.mcp_tool_use',
        id: 't1',
        name: 'mcp.call',
        input: {},
      };
      const next = chatReducer(initialState, { kind: 'events', events: [evt] });
      expect(next.draft!.toolUses).toHaveLength(1);
    });

    it('attaches tool_result to the last tool_use via new array', () => {
      const toolUse = { type: 'agent.tool_use', id: 't1', name: 'search', input: {} };
      const toolResult = {
        type: 'agent.tool_result',
        id: 'r1',
        content: [{ type: 'text', text: 'result data' }],
      };
      const next = chatReducer(initialState, {
        kind: 'events',
        events: [toolUse, toolResult],
      });
      expect(next.draft!.toolUses).toHaveLength(1);
      expect(next.draft!.toolUses[0].result).toEqual([{ type: 'text', text: 'result data' }]);
    });

    it('tool_result preserves identity of earlier tool entries', () => {
      const t1 = { type: 'agent.tool_use', id: 't1', name: 'a', input: {} };
      const t2 = { type: 'agent.tool_use', id: 't2', name: 'b', input: {} };
      const r2 = { type: 'agent.tool_result', id: 'r2', content: 'ok' };
      const afterT1T2 = chatReducer(initialState, {
        kind: 'events',
        events: [t1, t2],
      });
      const firstRef = afterT1T2.draft!.toolUses[0];
      const afterR2 = chatReducer(afterT1T2, { kind: 'events', events: [r2] });
      expect(afterR2.draft!.toolUses[0]).toBe(firstRef); // identity preserved
      expect(afterR2.draft!.toolUses[1].result).toBe('ok');
    });
  });

  describe('events: session lifecycle', () => {
    it('status_running sets sessionStatus', () => {
      const evt = { type: 'session.status_running', id: 's1' };
      const next = chatReducer(initialState, { kind: 'events', events: [evt] });
      expect(next.sessionStatus).toBe('running');
    });

    it('status_idle end_turn commits draft and idles', () => {
      const start = {
        ...initialState,
        draft: {
          id: 'draft-1',
          content: 'hello',
          toolUses: [{ id: 't1', name: 'x', input: {} }],
        },
      };
      const evt = {
        type: 'session.status_idle',
        id: 's1',
        stop_reason: { type: 'end_turn' },
      };
      const next = chatReducer(start, { kind: 'events', events: [evt] });
      expect(next.draft).toBeNull();
      expect(next.sessionStatus).toBe('idle');
      expect(next.messages).toHaveLength(1);
      expect(next.messages[0].role).toBe('agent');
      expect(next.messages[0].content).toBe('hello');
    });

    it('status_idle requires_action commits draft and adds system message', () => {
      const start = {
        ...initialState,
        draft: { id: 'draft-1', content: 'partial', toolUses: [] },
      };
      const evt = {
        type: 'session.status_idle',
        id: 's1',
        stop_reason: { type: 'requires_action' },
      };
      const next = chatReducer(start, { kind: 'events', events: [evt] });
      expect(next.draft).toBeNull();
      expect(next.sessionStatus).toBe('idle');
      expect(next.messages).toHaveLength(2);
      expect(next.messages[0].role).toBe('agent');
      expect(next.messages[1].role).toBe('system');
    });

    it('status_idle retries_exhausted commits draft and adds system message', () => {
      const start = {
        ...initialState,
        draft: { id: 'draft-1', content: 'partial', toolUses: [] },
      };
      const evt = {
        type: 'session.status_idle',
        id: 's1',
        stop_reason: { type: 'retries_exhausted' },
      };
      const next = chatReducer(start, { kind: 'events', events: [evt] });
      expect(next.sessionStatus).toBe('idle');
      expect(next.messages[1].role).toBe('system');
      expect(next.messages[1].content).toContain('repeated errors');
    });

    it('status_terminated commits draft and sets terminated', () => {
      const start = {
        ...initialState,
        draft: { id: 'draft-1', content: 'partial', toolUses: [] },
      };
      const evt = { type: 'session.status_terminated', id: 's1' };
      const next = chatReducer(start, { kind: 'events', events: [evt] });
      expect(next.draft).toBeNull();
      expect(next.sessionStatus).toBe('terminated');
      expect(next.messages).toHaveLength(1);
    });

    it('session.error pushes system message', () => {
      const evt = {
        type: 'session.error',
        id: 's1',
        error: { message: 'boom' },
      };
      const next = chatReducer(initialState, { kind: 'events', events: [evt] });
      expect(next.messages).toHaveLength(1);
      expect(next.messages[0].role).toBe('system');
    });
  });
});
