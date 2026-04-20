# Streaming Jank Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate UI jank during agent streaming by splitting ChatPage state into committed messages + streaming draft, batching SSE events per animation frame, fixing smooth-scroll conflict, and memoizing the message list.

**Architecture:** Pure reducer computes state transitions. SSE events are buffered and flushed once per animation frame. The in-progress agent turn ("draft") lives in its own state slot so token updates don't invalidate the committed message list. Memoized `MessageList` + `MessageBubble` skip re-render when committed messages are unchanged.

**Tech Stack:** React 19, TypeScript, Vite. New: Vitest for reducer unit tests.

**Spec:** `docs/superpowers/specs/2026-04-20-streaming-jank-design.md`

**Baseline check before starting.** All paths below are relative to the worktree root (`/home/clsandoval/cs/podplay-chat/.worktrees/streaming-jank`). Run `cd client && npm install` once before Task 1 if `node_modules/` is absent.

---

### Task 1: Add Vitest

**Files:**
- Create: `client/vitest.config.ts`
- Modify: `client/package.json` (devDeps + scripts)
- Create: `client/src/components/chat/__sanity__.test.ts`

- [ ] **Step 1.1: Install Vitest**

Run from `client/`:
```bash
npm install --save-dev vitest @vitest/ui
```

- [ ] **Step 1.2: Add test script to package.json**

Edit `client/package.json`, add to the `scripts` block:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 1.3: Create vitest config**

`client/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    globals: false,
  },
});
```

- [ ] **Step 1.4: Write a sanity test**

`client/src/components/chat/__sanity__.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('sanity', () => {
  it('vitest runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 1.5: Run and verify it passes**

```bash
cd client && npm test
```
Expected: 1 test passes, exit code 0.

- [ ] **Step 1.6: Commit**

```bash
git add client/package.json client/package-lock.json client/vitest.config.ts client/src/components/chat/__sanity__.test.ts
git commit -m "chore: add vitest for unit tests"
```

---

### Task 2: Reducer scaffold — types, initial state, `reset`

**Files:**
- Create: `client/src/components/chat/chatReducer.ts`
- Create: `client/src/components/chat/chatReducer.test.ts`

- [ ] **Step 2.1: Write the failing test**

`client/src/components/chat/chatReducer.test.ts`:
```ts
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
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
cd client && npm test chatReducer
```
Expected: FAIL with "Cannot find module './chatReducer'".

- [ ] **Step 2.3: Write the reducer scaffold**

`client/src/components/chat/chatReducer.ts`:
```ts
import type { Message, ToolUse } from './MessageBubble';
import type { AgentEvent } from '@/hooks/useEventStream';

export type Draft = {
  id: string;
  content: string;
  toolUses: ToolUse[];
};

export type SessionStatus = 'idle' | 'running' | 'terminated' | null;

export type ChatState = {
  messages: Message[];
  draft: Draft | null;
  sessionStatus: SessionStatus;
  pendingSends: number;
};

export type Action =
  | { kind: 'events'; events: AgentEvent[] }
  | { kind: 'restore'; messages: Message[] }
  | { kind: 'user_send'; message: Message }
  | { kind: 'reset' };

export const initialState: ChatState = {
  messages: [],
  draft: null,
  sessionStatus: null,
  pendingSends: 0,
};

export function chatReducer(state: ChatState, action: Action): ChatState {
  switch (action.kind) {
    case 'reset':
      return initialState;
    default:
      return state;
  }
}
```

- [ ] **Step 2.4: Run test to verify it passes**

```bash
cd client && npm test chatReducer
```
Expected: 2 tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add client/src/components/chat/chatReducer.ts client/src/components/chat/chatReducer.test.ts
git commit -m "feat(chat): add chatReducer scaffold with reset action"
```

---

### Task 3: Reducer — `user_send` action

**Files:**
- Modify: `client/src/components/chat/chatReducer.ts`
- Modify: `client/src/components/chat/chatReducer.test.ts`

- [ ] **Step 3.1: Write the failing tests**

Append to the top-level `describe('chatReducer', ...)` block in `chatReducer.test.ts`:
```ts
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
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
cd client && npm test chatReducer
```
Expected: FAIL — `next.messages` is `[]` because the reducer falls through to `default`.

- [ ] **Step 3.3: Implement user_send**

Replace the `switch` in `chatReducer.ts`:
```ts
  switch (action.kind) {
    case 'reset':
      return initialState;
    case 'user_send':
      return {
        ...state,
        messages: [...state.messages, action.message],
        draft: null,
        pendingSends: state.pendingSends + 1,
      };
    default:
      return state;
  }
```

- [ ] **Step 3.4: Run test to verify it passes**

```bash
cd client && npm test chatReducer
```
Expected: 4 tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add client/src/components/chat/chatReducer.ts client/src/components/chat/chatReducer.test.ts
git commit -m "feat(chat): add user_send reducer action"
```

---

### Task 4: Reducer — `restore` action

**Files:**
- Modify: `client/src/components/chat/chatReducer.ts`
- Modify: `client/src/components/chat/chatReducer.test.ts`

- [ ] **Step 4.1: Write the failing tests**

Append to the top-level `describe` block:
```ts
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
```

- [ ] **Step 4.2: Run test to verify it fails**

```bash
cd client && npm test chatReducer
```
Expected: FAIL — `next.messages` still the old array.

- [ ] **Step 4.3: Implement restore**

Add to the switch in `chatReducer.ts`, before `default`:
```ts
    case 'restore':
      return {
        messages: action.messages,
        draft: null,
        sessionStatus: 'idle',
        pendingSends: 0,
      };
```

- [ ] **Step 4.4: Run test to verify it passes**

```bash
cd client && npm test chatReducer
```
Expected: 5 tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add client/src/components/chat/chatReducer.ts client/src/components/chat/chatReducer.test.ts
git commit -m "feat(chat): add restore reducer action"
```

---

### Task 5: Reducer — `events` action: `user.message` with echo dedupe

**Files:**
- Modify: `client/src/components/chat/chatReducer.ts`
- Modify: `client/src/components/chat/chatReducer.test.ts`

- [ ] **Step 5.1: Write the failing tests**

Append to the top-level `describe`:
```ts
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
```

- [ ] **Step 5.2: Run test to verify it fails**

```bash
cd client && npm test chatReducer
```
Expected: FAIL — events action isn't implemented.

- [ ] **Step 5.3: Implement events action with user.message handling**

First, add a helper at the top of `chatReducer.ts` (above `chatReducer`):
```ts
function textFromBlocks(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((c): c is { type: 'text'; text: string } =>
      typeof c === 'object' && c !== null && (c as any).type === 'text' && typeof (c as any).text === 'string',
    )
    .map((c) => c.text)
    .join('');
}

let draftCounter = 0;
function newDraft(): Draft {
  return { id: `draft-${++draftCounter}-${Date.now()}`, content: '', toolUses: [] };
}
```

Then add to the switch, before `default`:
```ts
    case 'events': {
      let s = state;
      for (const event of action.events) {
        s = applyEvent(s, event);
      }
      return s;
    }
```

And add `applyEvent` below the reducer (unexported):
```ts
function applyEvent(state: ChatState, event: AgentEvent): ChatState {
  switch (event.type) {
    case 'user.message': {
      if (state.pendingSends > 0) {
        return { ...state, pendingSends: state.pendingSends - 1 };
      }
      const text = textFromBlocks(event.content);
      if (!text) return state;
      const msg: Message = {
        id: event.id ?? `msg-${Date.now()}`,
        role: 'user',
        content: text,
      };
      return { ...state, messages: [...state.messages, msg] };
    }
    default:
      return state;
  }
}
```

- [ ] **Step 5.4: Run test to verify it passes**

```bash
cd client && npm test chatReducer
```
Expected: 8 tests pass.

- [ ] **Step 5.5: Commit**

```bash
git add client/src/components/chat/chatReducer.ts client/src/components/chat/chatReducer.test.ts
git commit -m "feat(chat): reducer handles user.message with echo dedupe"
```

---

### Task 6: Reducer — `agent.message` text accumulation

**Files:**
- Modify: `client/src/components/chat/chatReducer.ts`
- Modify: `client/src/components/chat/chatReducer.test.ts`

- [ ] **Step 6.1: Write the failing tests**

Append to the top-level `describe`:
```ts
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
```

- [ ] **Step 6.2: Run test to verify it fails**

```bash
cd client && npm test chatReducer
```
Expected: FAIL — `agent.message` not handled.

- [ ] **Step 6.3: Extend applyEvent**

Add a case inside `applyEvent` in `chatReducer.ts`, before `default`:
```ts
    case 'agent.message': {
      const text = textFromBlocks(event.content);
      if (!text && !state.draft) return state;
      const draft = state.draft ?? newDraft();
      return {
        ...state,
        draft: { ...draft, content: draft.content + text },
      };
    }
```

- [ ] **Step 6.4: Run test to verify it passes**

```bash
cd client && npm test chatReducer
```
Expected: 11 tests pass.

- [ ] **Step 6.5: Commit**

```bash
git add client/src/components/chat/chatReducer.ts client/src/components/chat/chatReducer.test.ts
git commit -m "feat(chat): reducer accumulates agent.message into draft"
```

---

### Task 7: Reducer — `tool_use` + `tool_result`

**Files:**
- Modify: `client/src/components/chat/chatReducer.ts`
- Modify: `client/src/components/chat/chatReducer.test.ts`

- [ ] **Step 7.1: Write the failing tests**

Append:
```ts
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
```

- [ ] **Step 7.2: Run test to verify it fails**

```bash
cd client && npm test chatReducer
```
Expected: FAIL.

- [ ] **Step 7.3: Extend applyEvent**

Inside `applyEvent`, add before `default`:
```ts
    case 'agent.tool_use':
    case 'agent.mcp_tool_use': {
      const draft = state.draft ?? newDraft();
      const toolUse: ToolUse = {
        id: event.id ?? `tool-${Date.now()}`,
        name: (event as any).name ?? 'unknown',
        input: (event as any).input,
      };
      return {
        ...state,
        draft: { ...draft, toolUses: [...draft.toolUses, toolUse] },
      };
    }
    case 'agent.tool_result':
    case 'agent.mcp_tool_result': {
      if (!state.draft || state.draft.toolUses.length === 0) return state;
      const tools = state.draft.toolUses;
      const lastIdx = tools.length - 1;
      const newTools = tools.slice(0, lastIdx).concat({
        ...tools[lastIdx],
        result: (event as any).content,
      });
      return {
        ...state,
        draft: { ...state.draft, toolUses: newTools },
      };
    }
```

- [ ] **Step 7.4: Run test to verify it passes**

```bash
cd client && npm test chatReducer
```
Expected: 15 tests pass.

- [ ] **Step 7.5: Commit**

```bash
git add client/src/components/chat/chatReducer.ts client/src/components/chat/chatReducer.test.ts
git commit -m "feat(chat): reducer handles tool_use + tool_result"
```

---

### Task 8: Reducer — session lifecycle events

**Files:**
- Modify: `client/src/components/chat/chatReducer.ts`
- Modify: `client/src/components/chat/chatReducer.test.ts`

- [ ] **Step 8.1: Write the failing tests**

Append:
```ts
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
```

- [ ] **Step 8.2: Run test to verify it fails**

```bash
cd client && npm test chatReducer
```
Expected: FAIL.

- [ ] **Step 8.3: Extend applyEvent**

Add a helper and cases inside `applyEvent`. First, above `applyEvent`:
```ts
function commitDraft(state: ChatState): ChatState {
  if (!state.draft) return state;
  const committed: Message = {
    id: state.draft.id,
    role: 'agent',
    content: state.draft.content,
    toolUses: state.draft.toolUses,
  };
  return {
    ...state,
    messages: [...state.messages, committed],
    draft: null,
  };
}
```

Then in the switch, before `default`:
```ts
    case 'session.status_running':
      return { ...state, sessionStatus: 'running' };

    case 'session.status_idle': {
      const stopReason = (event as any).stop_reason?.type;
      const committed = commitDraft(state);
      if (stopReason === 'requires_action') {
        return {
          ...committed,
          sessionStatus: 'idle',
          messages: [
            ...committed.messages,
            {
              id: `sys-${event.id ?? Date.now()}`,
              role: 'system',
              content: 'The agent requires additional action to continue.',
            },
          ],
        };
      }
      if (stopReason === 'retries_exhausted') {
        return {
          ...committed,
          sessionStatus: 'idle',
          messages: [
            ...committed.messages,
            {
              id: `sys-${event.id ?? Date.now()}`,
              role: 'system',
              content: 'The agent encountered repeated errors and stopped.',
            },
          ],
        };
      }
      return { ...committed, sessionStatus: 'idle' };
    }

    case 'session.status_terminated': {
      const committed = commitDraft(state);
      return { ...committed, sessionStatus: 'terminated' };
    }

    case 'session.error': {
      const errMsg = (event as any).error?.message ?? JSON.stringify((event as any).error ?? 'Unknown error');
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: `sys-${event.id ?? Date.now()}`,
            role: 'system',
            content: `Something went wrong: ${errMsg}`,
          },
        ],
      };
    }
```

- [ ] **Step 8.4: Run test to verify it passes**

```bash
cd client && npm test chatReducer
```
Expected: 21 tests pass.

- [ ] **Step 8.5: Commit**

```bash
git add client/src/components/chat/chatReducer.ts client/src/components/chat/chatReducer.test.ts
git commit -m "feat(chat): reducer handles session lifecycle events"
```

---

### Task 9: `eventsToMessages` helper for history restore

**Files:**
- Create: `client/src/components/chat/eventsToMessages.ts`
- Create: `client/src/components/chat/eventsToMessages.test.ts`

- [ ] **Step 9.1: Write the failing tests**

`client/src/components/chat/eventsToMessages.test.ts`:
```ts
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
```

- [ ] **Step 9.2: Run test to verify it fails**

```bash
cd client && npm test eventsToMessages
```
Expected: FAIL with "Cannot find module".

- [ ] **Step 9.3: Write the helper**

`client/src/components/chat/eventsToMessages.ts`:
```ts
import type { Message, ToolUse } from './MessageBubble';
import type { AgentEvent } from '@/hooks/useEventStream';

function textFromBlocks(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((c): c is { type: 'text'; text: string } =>
      typeof c === 'object' && c !== null && (c as any).type === 'text' && typeof (c as any).text === 'string',
    )
    .map((c) => c.text)
    .join('');
}

let idCounter = 0;
function fallbackId(): string {
  return `hist-${++idCounter}-${Date.now()}`;
}

export function eventsToMessages(events: AgentEvent[]): Message[] {
  const out: Message[] = [];
  let currentAgent: Message | null = null;

  for (const event of events) {
    switch (event.type) {
      case 'user.message': {
        if (currentAgent) {
          out.push(currentAgent);
          currentAgent = null;
        }
        out.push({
          id: event.id ?? fallbackId(),
          role: 'user',
          content: textFromBlocks((event as any).content),
        });
        break;
      }
      case 'agent.message': {
        if (!currentAgent) {
          currentAgent = {
            id: event.id ?? fallbackId(),
            role: 'agent',
            content: '',
            toolUses: [],
          };
        }
        currentAgent.content += textFromBlocks((event as any).content);
        break;
      }
      case 'agent.tool_use':
      case 'agent.mcp_tool_use': {
        if (!currentAgent) {
          currentAgent = { id: fallbackId(), role: 'agent', content: '', toolUses: [] };
        }
        const tu: ToolUse = {
          id: event.id ?? fallbackId(),
          name: (event as any).name ?? 'unknown',
          input: (event as any).input,
        };
        currentAgent.toolUses!.push(tu);
        break;
      }
      case 'agent.tool_result':
      case 'agent.mcp_tool_result': {
        if (currentAgent && currentAgent.toolUses && currentAgent.toolUses.length > 0) {
          const last = currentAgent.toolUses[currentAgent.toolUses.length - 1];
          last.result = (event as any).content;
        }
        break;
      }
      default:
        break;
    }
  }
  if (currentAgent) out.push(currentAgent);
  return out;
}
```

- [ ] **Step 9.4: Run test to verify it passes**

```bash
cd client && npm test eventsToMessages
```
Expected: 5 tests pass.

- [ ] **Step 9.5: Commit**

```bash
git add client/src/components/chat/eventsToMessages.ts client/src/components/chat/eventsToMessages.test.ts
git commit -m "feat(chat): extract eventsToMessages helper for history restore"
```

---

### Task 10: rAF batching in `useEventStream`

**Files:**
- Modify: `client/src/hooks/useEventStream.ts`

This task changes the hook's callback contract from per-event to per-batch. Caller gets `onEvents(events: AgentEvent[])` instead of `onEvent(event)`. ChatPage will migrate in a later task.

- [ ] **Step 10.1: Read the current file**

Read `client/src/hooks/useEventStream.ts` in full.

- [ ] **Step 10.2: Replace the hook**

Overwrite `client/src/hooks/useEventStream.ts`:
```ts
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
```

- [ ] **Step 10.3: Typecheck**

```bash
cd client && npx tsc -b --noEmit
```
Expected: errors in `ChatPage.tsx` — it still expects per-event `onEvent`. Those get fixed in Task 14.

- [ ] **Step 10.4: Run existing tests**

```bash
cd client && npm test
```
Expected: reducer and helper tests still pass. No tests for the hook itself (covered by integration in later tasks).

- [ ] **Step 10.5: Commit**

```bash
git add client/src/hooks/useEventStream.ts
git commit -m "refactor(chat): batch SSE events per animation frame

onEvent(event) → onEvents(events). Events are buffered and flushed via
requestAnimationFrame, capping re-renders at one per frame. Event IDs
are tracked in-hook so replayed history events are filtered. ChatPage
migration follows in a subsequent commit and is expected to break
typecheck until then."
```

---

### Task 11: `StreamingBubble` component

**Files:**
- Create: `client/src/components/chat/StreamingBubble.tsx`

- [ ] **Step 11.1: Create the component**

`client/src/components/chat/StreamingBubble.tsx`:
```tsx
import { MessageBubble, type Message } from './MessageBubble';
import type { Draft } from './chatReducer';

interface StreamingBubbleProps {
  draft: Draft;
}

function draftToMessage(draft: Draft): Message {
  return {
    id: draft.id,
    role: 'agent',
    content: draft.content,
    toolUses: draft.toolUses,
  };
}

export function StreamingBubble({ draft }: StreamingBubbleProps) {
  return <MessageBubble message={draftToMessage(draft)} userInitials="" />;
}
```

- [ ] **Step 11.2: Typecheck component**

```bash
cd client && npx tsc -b --noEmit 2>&1 | grep -i "StreamingBubble" || echo "no StreamingBubble errors"
```
Expected: "no StreamingBubble errors".

- [ ] **Step 11.3: Commit**

```bash
git add client/src/components/chat/StreamingBubble.tsx
git commit -m "feat(chat): add StreamingBubble renders draft via MessageBubble"
```

---

### Task 12: `MessageList` memoized component

**Files:**
- Create: `client/src/components/chat/MessageList.tsx`

- [ ] **Step 12.1: Create the component**

`client/src/components/chat/MessageList.tsx`:
```tsx
import { memo } from 'react';
import { MessageBubble, type Message } from './MessageBubble';

interface MessageListProps {
  messages: Message[];
  userInitials: string;
}

function MessageListImpl({ messages, userInitials }: MessageListProps) {
  return (
    <>
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} userInitials={userInitials} />
      ))}
    </>
  );
}

export const MessageList = memo(MessageListImpl);
```

- [ ] **Step 12.2: Commit**

```bash
git add client/src/components/chat/MessageList.tsx
git commit -m "feat(chat): add memoized MessageList"
```

---

### Task 13: Memoize `MessageBubble`, `ToolUseBlock`, `ChatInput`

**Files:**
- Modify: `client/src/components/chat/MessageBubble.tsx`
- Modify: `client/src/components/chat/ToolUseBlock.tsx`
- Modify: `client/src/components/chat/ChatInput.tsx`

- [ ] **Step 13.1: Wrap MessageBubble**

In `client/src/components/chat/MessageBubble.tsx`, change the `export function MessageBubble(...)` declaration to:
```tsx
function MessageBubbleImpl({ message, userInitials }: MessageBubbleProps) {
  // ... existing body unchanged ...
}

export const MessageBubble = memo(MessageBubbleImpl);
```

Add `import { memo } from 'react';` to the top. Keep the existing `export interface ToolUse` and `export interface Message` exports as-is.

- [ ] **Step 13.2: Wrap ToolUseSummary**

The file exports one component: `ToolUseSummary`. Convert it.

At the top of `client/src/components/chat/ToolUseBlock.tsx`:
```tsx
import { memo, useState } from 'react';
```
(replace the existing `import { useState } from 'react';`).

Rename the exported function to `ToolUseSummaryImpl` and add the memoized export at the bottom of the file (after `ToolDetail`):
```tsx
function ToolUseSummaryImpl({ tools }: ToolUseSummaryProps) {
  // ... existing body ...
}

export const ToolUseSummary = memo(ToolUseSummaryImpl);
```

`ToolDetail` is a local helper and does not need memoization (it already only renders when its parent's `open` state flips).

- [ ] **Step 13.3: Wrap ChatInput**

In `client/src/components/chat/ChatInput.tsx`, same pattern:
```tsx
function ChatInputImpl({ onSend, disabled, placeholder }: ChatInputProps) {
  // ... existing body ...
}

export const ChatInput = memo(ChatInputImpl);
```

Add `import { memo } from 'react';`.

- [ ] **Step 13.4: Typecheck**

```bash
cd client && npx tsc -b --noEmit 2>&1 | grep -i "error" | head
```
Only remaining errors should be in `ChatPage.tsx` (from Task 10). Note them and continue.

- [ ] **Step 13.5: Commit**

```bash
git add client/src/components/chat/MessageBubble.tsx client/src/components/chat/ToolUseBlock.tsx client/src/components/chat/ChatInput.tsx
git commit -m "perf(chat): memoize MessageBubble, ToolUseBlock, ChatInput"
```

---

### Task 14: Wire reducer into `ChatPage`

**Files:**
- Modify: `client/src/components/chat/ChatPage.tsx` (full rewrite of the component body)

This is the biggest single change. The component keeps the same outer behavior — URL param handling, session creation flow, connection-status banner, disabled state — but all messages/draft/status state moves into `useReducer`.

- [ ] **Step 14.1: Rewrite ChatPage.tsx**

Overwrite `client/src/components/chat/ChatPage.tsx`:
```tsx
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
```

Note: `isCreatingSession` stays as `useState` because it drives conditional rendering (the initial empty-state placeholder and the typing indicator during session creation). It changes at most twice per turn (on/off), so it won't contribute to streaming jank.

- [ ] **Step 14.2: Typecheck**

```bash
cd client && npx tsc -b --noEmit
```
Expected: no errors.

- [ ] **Step 14.3: Build**

```bash
cd client && npm run build
```
Expected: clean build.

- [ ] **Step 14.4: Run all tests**

```bash
cd client && npm test
```
Expected: all reducer + helper tests pass.

- [ ] **Step 14.5: Commit**

```bash
git add client/src/components/chat/ChatPage.tsx
git commit -m "refactor(chat): wire reducer + batched events + split draft state

Splits committed messages from in-progress agent draft. MessageList is
memoized and skips re-render during streaming; only StreamingBubble
updates per token. handleSend is a stable callback via refs so ChatInput
does not re-render on reducer state changes. eventsToMessages handles
history restore as a single dispatch."
```

---

### Task 15: Scroll behavior — pinned-bottom tracking

**Files:**
- Modify: `client/src/components/chat/ChatPage.tsx`

- [ ] **Step 15.1: Add scroll tracking**

In `ChatPage.tsx`, immediately after the `useReducer` for sessionId, add:
```tsx
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isPinnedRef = useRef(true);
  const scrollRafRef = useRef<number | null>(null);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      isPinnedRef.current = nearBottom;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Scroll to bottom (rAF-coalesced) whenever content changes if pinned
  useEffect(() => {
    if (!isPinnedRef.current) return;
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = scrollContainerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [state.messages, state.draft]);
```

- [ ] **Step 15.2: Attach the ref to the scroll container and remove messagesEndRef**

Replace the `<div className="flex-1 overflow-y-auto py-6 space-y-6">` line with:
```tsx
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto py-6 space-y-6">
```

Remove any leftover `messagesEndRef` usage and the `<div ref={messagesEndRef} />` marker if still present.

- [ ] **Step 15.3: Pin on send**

At the start of `handleSend` (before `dispatch({ kind: 'user_send', ... })`):
```tsx
    isPinnedRef.current = true;
```

- [ ] **Step 15.4: Typecheck and build**

```bash
cd client && npx tsc -b --noEmit && npm run build
```
Expected: clean.

- [ ] **Step 15.5: Commit**

```bash
git add client/src/components/chat/ChatPage.tsx
git commit -m "perf(chat): replace smooth-scroll with pinned-bottom tracking

Scroll listener tracks whether the user is near the bottom. When pinned
the view scrolls instantly (rAF-coalesced) on new content; when scrolled
up, auto-scroll is suppressed."
```

---

### Task 16: Manual verification

**Files:** none (verification only)

- [ ] **Step 16.1: Start dev server**

```bash
cd client && npm run dev
```
In a separate terminal, start the server:
```bash
cd server && npm run dev
```

- [ ] **Step 16.2: Verify no jank during streaming**

Open the app in the browser. Send a message that produces a long agent reply.
- Text should stream smoothly without scroll jitter.
- Only the bottom bubble should be visibly updating.
- Open React DevTools Profiler; verify only `StreamingBubble` and `ChatPage` are re-rendering during token arrival. `MessageList` should not re-render per token.

- [ ] **Step 16.3: Verify input is not laggy during streaming**

While an agent reply is streaming, type into the input.
- Characters should appear with no perceptible delay.
- Sending a new message when status is `running` should still be blocked (button disabled).

- [ ] **Step 16.4: Verify history restore**

Navigate away from an existing session and back. Messages should restore once (no flashing), agent turns should retain tool-use summaries.

- [ ] **Step 16.5: Verify tool-use rendering**

Trigger an agent response that uses a tool. The tool-use summary should appear as part of the live streaming bubble and persist after `end_turn`.

- [ ] **Step 16.6: Verify scroll-away behavior**

Start a long reply. Scroll up while streaming. The view should stop auto-scrolling. Scroll back to the bottom — auto-scroll resumes.

- [ ] **Step 16.7: Record any issues as follow-up tasks**

If anything regresses (e.g. echo dedupe fails, restore order wrong, input flicker returns), note it here and fix before opening a PR.

---

## Self-review notes

- **Spec coverage check:** Architecture (Task 14), reducer with all event types (Tasks 2–8), eventsToMessages (Task 9), rAF batching (Task 10), StreamingBubble (Task 11), MessageList memo (Task 12), MessageBubble/ToolUseBlock/ChatInput memo (Task 13), scroll behavior (Task 15), manual verification (Task 16). Vitest bootstrap (Task 1) needed because the client has no test framework.
- **Not in this plan:** Playwright smoke test (client has no Playwright setup; manual verification covers the UX); port of daimon-cma typed event catalog; server-side SSE `read` timeout fix; `agent.thinking` rendering. All deferred per spec.
- **Server-side session manager** (`server/src/lib/session-manager.ts`) is untouched. If jank remains after these client fixes, revisit whether the 60s Node fetch read timeout is tearing the stream during long model turns (daimon-cma sets `read=None` for this reason).
