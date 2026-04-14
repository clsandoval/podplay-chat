import { Link } from '@tanstack/react-router';
import {
  MessageSquare,
  LayoutDashboard,
  Package,
  DollarSign,
  BookMarked,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { cn } from '@/lib/utils';

interface NavLink {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

interface NavSection {
  section: string;
  links: NavLink[];
}

const navSections: NavSection[] = [
  {
    section: 'Chat',
    links: [{ to: '/', label: 'Chat', icon: MessageSquare }],
  },
  {
    section: 'Operations',
    links: [
      { to: '/projects', label: 'Projects', icon: LayoutDashboard },
      { to: '/inventory', label: 'Inventory', icon: Package },
      { to: '/financials', label: 'Financials', icon: DollarSign },
    ],
  },
  {
    section: 'Resources',
    links: [{ to: '/guide', label: 'Guide', icon: BookMarked }],
  },
];

interface SidebarNavProps {
  onNavClick?: () => void;
  sessionList?: React.ReactNode;
}

export function SidebarNav({ onNavClick, sessionList }: SidebarNavProps) {
  return (
    <nav
      className="flex-1 overflow-y-auto px-3 py-4 space-y-5"
      aria-label="Site navigation"
    >
      {navSections.map(({ section, links }) => (
        <div key={section}>
          <p className="px-2 mb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {section}
          </p>
          <div className="space-y-0.5">
            {links.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                onClick={onNavClick}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                  'hover:bg-accent hover:text-accent-foreground text-muted-foreground',
                )}
                activeProps={{
                  className: 'bg-accent text-accent-foreground font-medium',
                }}
                activeOptions={to === '/' ? { exact: true } : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            ))}
          </div>
          {section === 'Chat' && sessionList}
        </div>
      ))}
    </nav>
  );
}
