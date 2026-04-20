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
});
