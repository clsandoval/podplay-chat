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
});
