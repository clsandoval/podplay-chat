import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

const callbackSearchSchema = z.object({
  code: z.string().optional(),
  redirect: z.string().optional(),
});

export const Route = createFileRoute('/auth/callback')({
  validateSearch: callbackSearchSchema,
  component: AuthCallbackRoute,
});

function AuthCallbackRoute() {
  const search = Route.useSearch();

  useEffect(() => {
    async function exchange() {
      if (!search.code) {
        window.location.href = '/login?error=missing_code';
        return;
      }

      const { error } = await supabase.auth.exchangeCodeForSession(search.code);
      if (error) {
        window.location.href = '/login?error=exchange_failed';
        return;
      }

      window.location.href = search.redirect ?? '/';
    }

    exchange();
  }, [search.code, search.redirect]);

  return (
    <div className="flex min-h-svh items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Signing you in...</p>
      </div>
    </div>
  );
}
