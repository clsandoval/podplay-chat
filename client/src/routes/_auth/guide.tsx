import { createFileRoute } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BookMarked, MessageSquare, GitBranch, FileText } from 'lucide-react';

export const Route = createFileRoute('/_auth/guide')({
  component: GuidePage,
});

function GuidePage() {
  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <h1 className="text-xl font-semibold tracking-tight">
        Operations Guide
      </h1>
      <p className="text-sm text-muted-foreground">
        PodPlay Chat is an AI-powered operations tool. All data lives in the{' '}
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
          podplay-data
        </code>{' '}
        GitHub repo as markdown files. Changes are made via pull requests.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <MessageSquare className="h-4 w-4" />
              Chat
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Ask questions about projects, inventory, financials, or any
            operational data. The agent reads files directly from the repo.
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <GitBranch className="h-4 w-4" />
              Making Changes
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            When you ask the agent to update data, it creates a branch, commits
            changes, and opens a pull request. All changes are tracked in git
            history.
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4" />
              Data Format
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Each record is a markdown file with YAML frontmatter for structured
            fields. Entity types: projects, inventory, vendors, invoices,
            expenses, and more.
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <BookMarked className="h-4 w-4" />
              Dashboards
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            The Projects, Inventory, and Financials tabs show read-only views
            of current data. Dashboards refresh within 60 seconds of a PR merge.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
