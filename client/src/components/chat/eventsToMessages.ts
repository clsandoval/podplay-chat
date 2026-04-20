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
