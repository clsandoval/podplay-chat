import { useState } from 'react';
import { ChevronRight, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ToolUseBlockProps {
  toolName: string;
  input?: any;
  result?: any;
}

export function ToolUseBlock({ toolName, input, result }: ToolUseBlockProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="my-2 rounded-md border bg-muted/50 text-sm">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/80 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-transform',
            open && 'rotate-90',
          )}
        />
        <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium text-xs">{toolName}</span>
      </button>
      {open && (
        <div className="border-t px-3 py-2 space-y-2">
          {input != null && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Input
              </p>
              <pre className="text-xs whitespace-pre-wrap break-all bg-background rounded p-2 overflow-x-auto">
                {typeof input === 'string' ? input : JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}
          {result != null && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Result
              </p>
              <pre className="text-xs whitespace-pre-wrap break-all bg-background rounded p-2 overflow-x-auto">
                {typeof result === 'string'
                  ? result
                  : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
