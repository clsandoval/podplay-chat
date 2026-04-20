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
