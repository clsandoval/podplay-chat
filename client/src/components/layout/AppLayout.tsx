import { Outlet } from '@tanstack/react-router';
import { LogOut, Menu } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { SidebarNav } from '@/components/layout/SidebarNav';
import { listSessions } from '@/lib/api';
import { SessionList } from '@/components/layout/SessionList';

export function AppLayout() {
  const { user, signOut } = useAuth();
  const initials = user?.email ? user.email.slice(0, 2).toUpperCase() : 'U';
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sessions, setSessions] = useState<
    Array<{ sessionId: string; title: string | null; createdAt: string }>
  >([]);

  useEffect(() => {
    listSessions()
      .then((data) => setSessions(data.slice(0, 10)))
      .catch(() => {
        // silently fail — sidebar sessions are non-critical
      });
  }, []);

  const sessionListNode = <SessionList sessions={sessions} />;

  return (
    <div className="flex h-svh overflow-hidden">
      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex w-60 shrink-0 border-r bg-background flex-col"
        aria-label="Main navigation"
      >
        <div className="flex h-14 items-center border-b px-4 shrink-0">
          <span className="text-base font-semibold tracking-tight">
            PodPlay Chat
          </span>
        </div>
        <SidebarNav sessionList={sessionListNode} />
      </aside>

      {/* Mobile Sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-60 p-0">
          <div className="flex h-14 items-center border-b px-4 shrink-0">
            <span className="text-base font-semibold tracking-tight">
              PodPlay Chat
            </span>
          </div>
          <SidebarNav
            onNavClick={() => setMobileOpen(false)}
            sessionList={sessionListNode}
          />
        </SheetContent>
      </Sheet>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header
          className="flex h-14 items-center justify-between border-b px-4 shrink-0 bg-background"
          aria-label="App header"
        >
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label="Open navigation menu"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <span className="font-semibold md:hidden">PodPlay Chat</span>
          </div>
          <div className="hidden md:block" />
          <div className="flex items-center gap-3">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium"
              title={user?.email}
            >
              {initials}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void signOut()}
              className="gap-1.5"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </div>
        </header>

        {/* Page content */}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 overflow-y-auto outline-none"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
