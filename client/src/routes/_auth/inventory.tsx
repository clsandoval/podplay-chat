import { createFileRoute } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { parseFrontmatter } from '@/lib/frontmatter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchDirectory, fetchFile } from '@/lib/github';

interface InventoryItem {
  name: string;
  sku: string;
  onHand: number | string;
  allocated: number | string;
  onOrder: number | string;
  status: string;
}

export const Route = createFileRoute('/_auth/inventory')({
  component: InventoryPage,
});

function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const files = await fetchDirectory('data/inventory');
        const data: InventoryItem[] = [];

        for (const file of files) {
          if (file.type !== 'file' || !file.name.endsWith('.md')) continue;
          try {
            const content = await fetchFile(`data/inventory/${file.name}`);
            const { data: fm } = parseFrontmatter(content);
            data.push({
              name: fm.name ?? file.name.replace('.md', ''),
              sku: fm.sku ?? '-',
              onHand: fm.on_hand ?? '-',
              allocated: fm.allocated ?? '-',
              onOrder: fm.on_order ?? '-',
              status: fm.status ?? 'unknown',
            });
          } catch {
            // skip
          }
        }
        setItems(data);
      } catch (e: any) {
        setError(e.message ?? 'Failed to load inventory');
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
      <h1 className="text-xl font-semibold tracking-tight">Inventory</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hardware Stock</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No inventory items found.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium">Name</th>
                    <th className="text-left py-2 px-3 font-medium">SKU</th>
                    <th className="text-right py-2 px-3 font-medium">
                      On Hand
                    </th>
                    <th className="text-right py-2 px-3 font-medium">
                      Allocated
                    </th>
                    <th className="text-right py-2 px-3 font-medium">
                      On Order
                    </th>
                    <th className="text-left py-2 px-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.sku} className="border-b last:border-0">
                      <td className="py-2 px-3 font-medium">{item.name}</td>
                      <td className="py-2 px-3 text-muted-foreground">
                        {item.sku}
                      </td>
                      <td className="py-2 px-3 text-right">{item.onHand}</td>
                      <td className="py-2 px-3 text-right">
                        {item.allocated}
                      </td>
                      <td className="py-2 px-3 text-right">{item.onOrder}</td>
                      <td className="py-2 px-3">
                        <StatusBadge status={item.status} />
                      </td>
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
    ready: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
    'on order':
      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
    'in transit':
      'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? 'bg-muted text-muted-foreground'}`}
    >
      {status}
    </span>
  );
}
