import { createFileRoute } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import matter from 'gray-matter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchDirectory, fetchFile } from '@/lib/github';

interface Project {
  name: string;
  status: string;
  tier: string;
  client: string;
  deploymentDate: string;
}

export const Route = createFileRoute('/_auth/projects')({
  component: ProjectsPage,
});

function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const files = await fetchDirectory('data/projects');
        const projectData: Project[] = [];

        for (const file of files) {
          if (file.type !== 'file' || !file.name.endsWith('.md')) continue;
          try {
            const content = await fetchFile(`data/projects/${file.name}`);
            const { data: fm } = matter(content);
            projectData.push({
              name: fm.name ?? file.name.replace('.md', ''),
              status: fm.status ?? 'unknown',
              tier: fm.tier ?? '-',
              client: fm.client ?? '-',
              deploymentDate: fm.deployment_date ?? '-',
            });
          } catch {
            // skip files that fail to parse
          }
        }
        setProjects(projectData);
      } catch (e: any) {
        setError(e.message ?? 'Failed to load projects');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Venue Installations</CardTitle>
        </CardHeader>
        <CardContent>
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">No projects found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium">Name</th>
                    <th className="text-left py-2 px-3 font-medium">Status</th>
                    <th className="text-left py-2 px-3 font-medium">Tier</th>
                    <th className="text-left py-2 px-3 font-medium">Client</th>
                    <th className="text-left py-2 px-3 font-medium">
                      Deployment Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => (
                    <tr key={p.name} className="border-b last:border-0">
                      <td className="py-2 px-3 font-medium">{p.name}</td>
                      <td className="py-2 px-3">
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="py-2 px-3">{p.tier}</td>
                      <td className="py-2 px-3">{p.client}</td>
                      <td className="py-2 px-3">{p.deploymentDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
    completed:
      'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
    planning:
      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? 'bg-muted text-muted-foreground'}`}
    >
      {status}
    </span>
  );
}
