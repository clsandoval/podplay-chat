import { createFileRoute } from '@tanstack/react-router';
import { ProtectedRoute } from '@/lib/auth-guard';

export const Route = createFileRoute('/_auth')({
  component: ProtectedRoute,
});
