import { memo, useState } from 'react';
import { ChevronRight, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ToolUse {
  id: string;
  name: string;
  input?: any;
  result?: any;
}

interface ToolUseSummaryProps {
  tools: ToolUse[];
}

/** Renders all tool calls as a single collapsible summary line. */
function ToolUseSummaryImpl({ tools }: ToolUseSummaryProps) {
  const [open, setOpen] = useState(false);

  if (tools.length === 0) return null;

  // Dedupe tool names for the summary label
  const names = [...new Set(tools.map((t) => t.name))];
  const label =
    tools.length === 1
      ? names[0]
      : `${tools.length} tool calls — ${names.join(', ')}`;

  return (
    <div className="mt-1.5 rounded-md border bg-muted/40 text-xs">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <ChevronRight
          className={cn(
            'h-3 w-3 shrink-0 transition-transform',
            open && 'rotate-90',
          )}
        />
        <Wrench className="h-3 w-3 shrink-0" />
        <span className="truncate">{label}</span>
      </button>
      {open && (
        <div className="border-t divide-y">
          {tools.map((tool) => (
            <ToolDetail key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolDetail({ tool }: { tool: ToolUse }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="px-2.5 py-1.5">
      <button
        type="button"
        className="flex items-center gap-1.5 text-left text-muted-foreground hover:text-foreground transition-colors w-full"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          className={cn(
            'h-2.5 w-2.5 shrink-0 transition-transform',
            expanded && 'rotate-90',
          )}
        />
        <span className="font-medium">{tool.name}</span>
      </button>
      {expanded && (
        <div className="mt-1 space-y-1 pl-4">
          {tool.input != null && (
            <pre className="text-[11px] whitespace-pre-wrap break-all bg-background rounded p-1.5 overflow-x-auto max-h-40 overflow-y-auto">
              {typeof tool.input === 'string'
                ? tool.input
                : JSON.stringify(tool.input, null, 2)}
            </pre>
          )}
          {tool.result != null && (
            <pre className="text-[11px] whitespace-pre-wrap break-all bg-background rounded p-1.5 overflow-x-auto max-h-40 overflow-y-auto">
              {typeof tool.result === 'string'
                ? tool.result
                : JSON.stringify(tool.result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export const ToolUseSummary = memo(ToolUseSummaryImpl);
