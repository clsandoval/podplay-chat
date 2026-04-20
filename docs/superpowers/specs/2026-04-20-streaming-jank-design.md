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
│       pendingSends: number       // optimistic sends awaiting user.message echo
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
  pendingSends: number;      // count of optimistic user messages awaiting echo
};

type Action =
  | { kind: 'events'; events: AgentEvent[] }        // batched from rAF, already deduped
  | { kind: 'restore'; messages: Message[] }         // history load, one-shot
  | { kind: 'user_send'; message: Message }          // optimistic local append
  | { kind: 'reset' };                               // session switch
```

**Dedupe lives outside the reducer.** `seenEventIds` stays in a `useRef`; the rAF flush filters out events with IDs already seen before calling `dispatch({ kind: 'events', events })`. The reducer treats its input as authoritative.

**Action semantics:**

- `user_send` → append `message` to `messages`, increment `pendingSends`, set `draft = null` (new turn starting).
- `restore` → replace `messages`, null `draft`, reset `pendingSends = 0`, `sessionStatus = 'idle'`.
- `reset` → return initial state (empty messages, null draft, null status, 0 pending). Used on session switch or unmount.
- `events` → see table below.

### Reducer — `events` action

Applied in order over the batch:

| Event | Effect |
|---|---|
| `user.message` | If `pendingSends > 0`, decrement and skip (echo of optimistic send); else append to `messages`. **Note:** this replaces the current content-equality dedupe, which incorrectly collapses two identical consecutive user sends into one. |
| `agent.message` | `draft ??= newDraft()`; extract text from `content` blocks where `c.type === 'text'`, concatenate, append to `draft.content` |
| `agent.tool_use` / `mcp_tool_use` | `draft ??= newDraft()`; push new ToolUse to `draft.toolUses` |
| `agent.tool_result` / `mcp_tool_result` | Return a new `draft.toolUses` array: all entries except the last keep their identity by reference; the last entry is replaced with `{...last, result: event.content}`. Reducer does not mutate. |
| `session.status_running` | `sessionStatus = 'running'` |
| `session.status_idle` (`end_turn`) | Commit: push `draft` into `messages`, set `draft = null`, `sessionStatus = 'idle'` |
| `session.status_idle` (`requires_action` / `retries_exhausted`) | Commit draft (if any), push system message, idle |
| `session.status_terminated` | Commit draft (if any), `sessionStatus = 'terminated'` |
| `session.error` | Push system message with error |

Unknown event types are ignored.

**Draft ID** is generated locally via the existing `nextId()` helper when the draft is first created — not pulled from any event. The draft's identity is a UI concern (React key), not a CMA event id.

### Identity rules

Critical for `React.memo` to pay off:

- Committed `messages` gets a new array reference *only* when a new message is added (user send, draft commit, restore, system message).
- During streaming, `messages` identity is stable — no `.map()`, no spread.
- `draft` is a single object rebuilt per frame; `<StreamingBubble>` always rerenders. Cheap because it's one component, not a list.

## History restore

The existing event-to-messages mapping in `ChatPage.tsx` (attachment queue that pairs image/document blocks with uploaded attachment records, server-injected text-block detection, agent-turn aggregation) is preserved verbatim — just moved into a helper `eventsToMessages(events, attachments): Message[]` so it can be unit-tested. The component still calls `getHistory()` and passes the result through this helper, then dispatches `{ kind: 'restore', messages }`. All event IDs from history are added to `seenEventIds` before SSE connects, so replay is filtered.

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

- Track `isPinnedToBottom` via a `{ passive: true }` scroll listener on the message container — true if user is within ~80px of bottom.
- On new content:
  - **Pinned →** scroll to bottom instantly (no smooth), rAF-throttled so multiple updates in a frame scroll once.
  - **Not pinned →** don't scroll. Show a floating "↓ N new messages" pill anchored above the input; clicking jumps to bottom.
- On user send → always pin + scroll.

**Typing indicator:** the existing `<TypingIndicator />` shows when `sessionStatus === 'running'`. Now that the streaming draft itself renders as a live bubble, the indicator is only needed *before* the first `agent.message` arrives. Render condition becomes `sessionStatus === 'running' && !draft`.

## Memoization

- `MessageBubble` → `React.memo(MessageBubble)`. Default shallow-equal works because committed messages preserve identity.
- `ToolUseBlock` → `React.memo`, same reasoning.
- `StreamingBubble` → not memoized; rerenders on every `draft` change. Rendered as `<MessageBubble message={draftToMessage(draft)} />` — `draftToMessage` wraps the Draft into a Message shape (role: 'agent', plus content and toolUses). Avoids duplicating the bubble render logic. Given explicitly from its own state slot so it never shares array identity with committed messages.
- `ChatInput` → `React.memo` + a truly stable `handleSend`. The current `handleSend` closes over `messages`, `sessionId`, and `user`, so `useCallback` alone would rebuild it on every draft change. Pattern: keep `handleSend` as a single `useCallback` with no dependencies; read mutable values through refs (`sessionIdRef`, `userRef`, reducer state via `stateRef` updated in a `useEffect`). `inputDisabled` is a small prop that only changes on `sessionStatus` / `isCreatingSession` — acceptable.
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

## Preserved as-is

- **`handoffState` module-level variable** (`ChatPage.tsx:30-34`) — bridges the `/` → `/chat/$sessionId` navigation so the new route mount restores messages instead of flashing empty. Orthogonal to the jank fix. Update the handoff shape to include `draft` and `pendingSends` alongside `messages`, otherwise untouched.
- Existing SSE reconnection logic in `server/src/lib/session-manager.ts`.
- `useEventStream`'s connection-lifecycle / gen-guard logic. Only the message handler changes (adds rAF batching).

## Out of scope

- Port daimon-cma's typed event catalog (Approach C from brainstorm). Nice-to-have, orthogonal to jank.
- Server-side SSE `read` timeout fix.
- `agent.thinking` event rendering.
