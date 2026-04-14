export function TypingIndicator() {
  return (
    <div className="flex items-start gap-3 max-w-[800px] mx-auto px-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background text-xs font-bold">
        P
      </div>
      <div className="flex items-center gap-1.5 rounded-lg bg-muted px-4 py-3">
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" />
        <span
          className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground"
          style={{ animationDelay: '0.2s' }}
        />
        <span
          className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground"
          style={{ animationDelay: '0.4s' }}
        />
        <style>{`
          @keyframes typingBounce {
            0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
            30% { opacity: 1; transform: translateY(-4px); }
          }
          .typing-dot {
            animation: typingBounce 1.4s infinite;
          }
        `}</style>
      </div>
    </div>
  );
}
