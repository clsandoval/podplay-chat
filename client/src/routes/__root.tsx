import { createRootRoute, Outlet } from '@tanstack/react-router';

export const Route = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: () => (
    <div className="flex min-h-svh items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">404 — Page not found</h1>
        <a href="/" className="mt-4 inline-block text-sm text-muted-foreground underline">
          Go home
        </a>
      </div>
    </div>
  ),
});
