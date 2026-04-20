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

export function chatReducer(state: ChatState, action: Action): ChatState {
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
    case 'restore':
      return {
        messages: action.messages,
        draft: null,
        sessionStatus: 'idle',
        pendingSends: 0,
      };
    case 'events': {
      let s = state;
      for (const event of action.events) {
        s = applyEvent(s, event);
      }
      return s;
    }
    default:
      return state;
  }
}

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
    case 'agent.message': {
      const text = textFromBlocks(event.content);
      if (!text && !state.draft) return state;
      const draft = state.draft ?? newDraft();
      return {
        ...state,
        draft: { ...draft, content: draft.content + text },
      };
    }
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
    default:
      return state;
  }
}
