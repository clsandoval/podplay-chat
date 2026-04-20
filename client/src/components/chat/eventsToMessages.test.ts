import { describe, it, expect } from 'vitest';
import { eventsToMessages } from './eventsToMessages';

describe('eventsToMessages', () => {
  it('returns empty for empty input', () => {
    expect(eventsToMessages([])).toEqual([]);
  });

  it('converts user.message to a user Message', () => {
    const events = [
      { type: 'user.message', id: 'u1', content: [{ type: 'text', text: 'hi' }] },
    ];
    const result = eventsToMessages(events);
    expect(result).toEqual([
      { id: 'u1', role: 'user', content: 'hi' },
    ]);
  });

  it('aggregates multiple agent.message events into one agent turn', () => {
    const events = [
      { type: 'agent.message', id: 'a1', content: [{ type: 'text', text: 'Hel' }] },
      { type: 'agent.message', id: 'a2', content: [{ type: 'text', text: 'lo' }] },
    ];
    const result = eventsToMessages(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ role: 'agent', content: 'Hello' });
  });

  it('attaches tool_use and tool_result to the current agent turn', () => {
    const events = [
      { type: 'agent.message', id: 'a1', content: [{ type: 'text', text: 'Thinking' }] },
      { type: 'agent.tool_use', id: 't1', name: 'search', input: { q: 'x' } },
      { type: 'agent.tool_result', id: 'r1', content: 'ok' },
    ];
    const result = eventsToMessages(events);
    expect(result).toHaveLength(1);
    expect(result[0].toolUses).toHaveLength(1);
    expect(result[0].toolUses![0].result).toBe('ok');
  });

  it('starts a new agent turn after each user.message', () => {
    const events = [
      { type: 'user.message', id: 'u1', content: [{ type: 'text', text: 'q1' }] },
      { type: 'agent.message', id: 'a1', content: [{ type: 'text', text: 'r1' }] },
      { type: 'user.message', id: 'u2', content: [{ type: 'text', text: 'q2' }] },
      { type: 'agent.message', id: 'a2', content: [{ type: 'text', text: 'r2' }] },
    ];
    const result = eventsToMessages(events);
    expect(result).toHaveLength(4);
    expect(result.map((m) => m.role)).toEqual(['user', 'agent', 'user', 'agent']);
  });
});
