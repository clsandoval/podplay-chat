# Streaming Jank Fix — Design

Date: 2026-04-20
Branch: `fix/streaming-jank`

## Problem

The chat UI stutters and flickers while the agent streams a response. The jank shows up in four places:

1. **Active streaming** — tokens arriving from the SSE stream.
2. **History restore** — initial load of a resumed session.
3. **Tool-use blocks** — render laggy or flash as tool_use / tool_result events arrive.
4. **Typing in the input** while the agent is streaming.

## Root causes

Located in `client/src/components/chat/ChatPage.tsx` and `client/src/hooks/useEventStream.ts`.

1. `scrollIntoView({ behavior: 'smooth' })` fires on every `messages` / `sessionStatus` change. Each token restarts the smooth-scroll animation, so the scroll position jitters the whole turn.
2. Every `agent.message` event runs `setMessages((prev) => prev.map(...))` with an object spread on the target message. The `.map()` returns a new array and a new reference for every message in the list, so every `MessageBubble` re-renders per token — not just the one streaming.
3. No event batching. Each SSE `onmessage` triggers its own dispatch. Even with React 18 auto-batching, each network arrival is its own render cycle.
4. `ChatInput` lives in the same component as `messages` state. Every streaming re-render of `ChatPage` rerenders `ChatInput`, which is why typing lags during streaming.
5. History restore runs a full reduce over all events, each mutating in-progress `currentAgent`, then calls `setMessages(restored)` once — that part is fine — but then SSE replay immediately fires 50+ events each with its own dispatch, flooding renders.

## Approach

Split component state into **committed messages** and **streaming draft**. Use a reducer to compute state transitions, batch SSE events per animation frame, fix scroll behavior, and memoize the list.

### Architecture

```
ChatPage (container)
├── useReducer(chatReducer, initialState)
│     state = {
│       messages: Message[]       // committed turns (user + completed agent)
│       draft: Draft | null        // in-progress agent turn
│       sessionStatus: ...
│     }
├── event pipeline
│     SSE onmessage → bufferRef.push(event)
│                   → rAF scheduler (single dispatch per frame)
│                   → reducer computes next state
├── render
│     <MessageList messages={state.messages} />   // rerenders only when committed turns change
│     <StreamingBubble draft={state.draft} />     // rerenders per token (isolated)
│     <ChatInput ... />                            // memoized, stable callbacks
```

Why this fixes all four symptoms:

- **Active streaming:** the `messages` array identity is unchanged during a turn, so the list skips re-render; only `<StreamingBubble>` updates.
- **History restore:** a single `restore` action rebuilds the list once. rAF batching coalesces the post-restore replay into one dispatch per frame.
- **Tool-use:** tool_use / tool_result events mutate `draft.toolUses`, not `messages`. No committed message changes during a turn.
- **Input typing:** `<ChatInput>` memoized + stable props → untouched by stream churn.

## State shape

```ts
type Draft = {
  id: string;
  content: string;           // accumulated text from agent.message events
  toolUses: ToolUse[];       // appended from tool_use, mutated by tool_result
};

type ChatState = {
  messages: Message[];       // committed turns only
  draft: Draft | null;
  sessionStatus: 'idle' | 'running' | 'terminated' | null;
};

type Action =
  | { kind: 'events'; events: AgentEvent[] }        // batched from rAF
  | { kind: 'restore'; messages: Message[] }         // history load, one-shot
  | { kind: 'user_send'; message: Message }          // optimistic local append
  | { kind: 'reset' };                               // session switch
```

`seenEventIds` stays in a `useRef` (dedupe is a side-concern, not state).

### Reducer — `events` action

Applied in order over the batch:

| Event | Effect |
|---|---|
| `user.message` | Skip if `pendingSendRef` > 0 (echo of optimistic send); else append to `messages` |
| `agent.message` | `draft ??= newDraft()`; append text to `draft.content` |
| `agent.tool_use` / `mcp_tool_use` | `draft ??= newDraft()`; push to `draft.toolUses` |
| `agent.tool_result` / `mcp_tool_result` | Mutate *only the last* entry in `draft.toolUses`; other entries keep identity |
| `session.status_running` | `sessionStatus = 'running'` |
| `session.status_idle` (`end_turn`) | Commit: push `draft` into `messages`, set `draft = null`, `sessionStatus = 'idle'` |
| `session.status_idle` (`requires_action` / `retries_exhausted`) | Commit draft (if any), push system message, idle |
| `session.status_terminated` | Commit draft (if any), `sessionStatus = 'terminated'` |
| `session.error` | Push system message with error |

### Identity rules

Critical for `React.memo` to pay off:

- Committed `messages` gets a new array reference *only* when a new message is added (user send, draft commit, restore, system message).
- During streaming, `messages` identity is stable — no `.map()`, no spread.
- `draft` is a single object rebuilt per frame; `<StreamingBubble>` always rerenders. Cheap because it's one component, not a list.

## Event batching

SSE events can arrive faster than 60fps during heavy streaming. rAF batching caps renders at one per frame.

```ts
// inside useEventStream (or extracted into useBatchedEvents)
const bufferRef = useRef<AgentEvent[]>([]);
const rafRef = useRef<number | null>(null);

function schedule(event: AgentEvent) {
  bufferRef.current.push(event);
  if (rafRef.current !== null) return;
  rafRef.current = requestAnimationFrame(() => {
    const batch = bufferRef.current;
    bufferRef.current = [];
    rafRef.current = null;
    if (batch.length > 0) onBatch(batch);   // single dispatch
  });
}

es.onmessage = (e) => {
  try { schedule(JSON.parse(e.data)); } catch {}
};
```

Edge cases:

- **Session switch / unmount:** cancel pending rAF, drop buffer in `close()`.
- **Tab backgrounded:** rAF pauses. Events queue in buffer until tab returns, then flush together. No loss. Unbounded growth not a concern — concurrency ceiling is ~20 users and tab-background times are short.
- **First connect with replay:** server sends buffered events one at a time; rAF naturally coalesces them into one dispatch on the next frame.

Remove the per-event `console.log` from the hot path — log at batch flush instead, behind a debug flag.

## Scroll behavior

Current: `scrollIntoView({ behavior: 'smooth' })` on every messages/draft change. Fights itself.

New:

- Track `isPinnedToBottom` via a scroll listener on the message container — true if user is within ~80px of bottom.
- On new content:
  - **Pinned →** scroll to bottom instantly (no smooth), rAF-throttled so multiple updates in a frame scroll once.
  - **Not pinned →** don't scroll. Show a floating "↓ N new messages" pill anchored above the input; clicking jumps to bottom.
- On user send → always pin + scroll.

## Memoization

- `MessageBubble` → `React.memo(MessageBubble)`. Default shallow-equal works because committed messages preserve identity.
- `ToolUseBlock` → `React.memo`, same reasoning.
- `StreamingBubble` → not memoized; rerenders on every `draft` change.
- `ChatInput` → `React.memo` + `useCallback` for `handleSend`. `inputDisabled` derived from `sessionStatus` + `isCreatingSession`, which rarely change mid-turn.
- `MessageList` → split into its own memoized component so `ChatPage`'s rerenders (draft updates) don't traverse the list.

Equality gotchas:

- `message.attachments` arrays are set once at construction and never mutated → shallow equality is safe.
- `toolUses` array in a committed message is never mutated after commit → safe.

## Testing

**Reducer unit tests** (new, `client/src/components/chat/chatReducer.test.ts`). Pure function, easy to cover:

- `events` action with a single `agent.message` starts a draft.
- Multiple `agent.message` events accumulate text into the same draft.
- `tool_use` then `tool_result` attaches result to last tool use.
- `status_idle{end_turn}` commits draft → messages, nulls draft.
- `status_idle{requires_action}` commits draft + pushes system message.
- `user.message` echo deduped against optimistic send.
- `restore` action replaces messages, nulls draft.
- Interleaved `agent.message` + `tool_use` + `agent.message` produces correct single draft.

**Playwright smoke test** (extend `docs/file-interactions-qa-spec.md` pattern): agent streams a long reply; assert no `scroll` event fires with `behavior: 'smooth'` during streaming, and message count stays at 1 until `end_turn`.

**Manual:** type in input while agent is streaming a long reply; confirm no input lag.

## Rollout

- Single PR on `fix/streaming-jank`.
- No feature flag — concurrency ceiling is ~20 users, rollback via revert.
- `useEventStream` hook keeps its shape; rAF batching added inside.
- `ChatPage.tsx` gets the reducer + structural split — expect ~300 lines rewritten.
- `server/src/lib/session-manager.ts` left alone. The server-side `fetch` has Node's default 60s read timeout, which can tear the SSE stream during long model turns (daimon-cma sets `read=None` for this reason). Revisit separately if client fixes don't fully resolve jank.

## Out of scope

- Port daimon-cma's typed event catalog (Approach C from brainstorm). Nice-to-have, orthogonal to jank.
- Server-side SSE `read` timeout fix.
- `agent.thinking` event rendering.
