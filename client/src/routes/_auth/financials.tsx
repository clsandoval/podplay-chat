import { createFileRoute } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import matter from 'gray-matter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchDirectory, fetchFile } from '@/lib/github';

interface Invoice {
  name: string;
  amount: string;
  status: string;
  dueDate: string;
}

interface Expense {
  name: string;
  amount: string;
  category: string;
  vendor: string;
}

export const Route = createFileRoute('/_auth/financials')({
  component: FinancialsPage,
});

function FinancialsPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        // Load invoices
        const invFiles = await fetchDirectory('data/invoices').catch(
          () => [] as any[],
        );
        const invData: Invoice[] = [];
        for (const file of invFiles) {
          if (file.type !== 'file' || !file.name.endsWith('.md')) continue;
          try {
            const content = await fetchFile(`data/invoices/${file.name}`);
            const { data: fm } = matter(content);
            invData.push({
              name: fm.name ?? file.name.replace('.md', ''),
              amount: fm.amount ?? '-',
              status: fm.status ?? 'unknown',
              dueDate: fm.due_date ?? '-',
            });
          } catch {
            // skip
          }
        }
        setInvoices(invData);

        // Load expenses
        const expFiles = await fetchDirectory('data/expenses').catch(
          () => [] as any[],
        );
        const expData: Expense[] = [];
        for (const file of expFiles) {
          if (file.type !== 'file' || !file.name.endsWith('.md')) continue;
          try {
            const content = await fetchFile(`data/expenses/${file.name}`);
            const { data: fm } = matter(content);
            expData.push({
              name: fm.name ?? file.name.replace('.md', ''),
              amount: fm.amount ?? '-',
              category: fm.category ?? '-',
              vendor: fm.vendor ?? '-',
            });
          } catch {
            // skip
          }
        }
        setExpenses(expData);
      } catch (e: any) {
        setError(e.message ?? 'Failed to load financials');
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
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Financials</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium">Name</th>
                    <th className="text-right py-2 px-3 font-medium">
                      Amount
                    </th>
                    <th className="text-left py-2 px-3 font-medium">Status</th>
                    <th className="text-left py-2 px-3 font-medium">
                      Due Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.name} className="border-b last:border-0">
                      <td className="py-2 px-3 font-medium">{inv.name}</td>
                      <td className="py-2 px-3 text-right">{inv.amount}</td>
                      <td className="py-2 px-3">
                        <StatusBadge status={inv.status} />
                      </td>
                      <td className="py-2 px-3">{inv.dueDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Expenses</CardTitle>
        </CardHeader>
        <CardContent>
          {expenses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No expenses found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium">Name</th>
                    <th className="text-right py-2 px-3 font-medium">
                      Amount
                    </th>
                    <th className="text-left py-2 px-3 font-medium">
                      Category
                    </th>
                    <th className="text-left py-2 px-3 font-medium">Vendor</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((exp) => (
                    <tr key={exp.name} className="border-b last:border-0">
                      <td className="py-2 px-3 font-medium">{exp.name}</td>
                      <td className="py-2 px-3 text-right">{exp.amount}</td>
                      <td className="py-2 px-3">{exp.category}</td>
                      <td className="py-2 px-3">{exp.vendor}</td>
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
    paid: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
    pending:
      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
    overdue: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? 'bg-muted text-muted-foreground'}`}
    >
      {status}
    </span>
  );
}
