import { createMiddleware } from 'hono/factory';
import { supabase } from '../lib/supabase.js';

export type AuthEnv = {
  Variables: {
    userId: string;
    userEmail: string;
  };
};

export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  // Support both header-based auth and query param (for EventSource which can't set headers)
  const authHeader = c.req.header('Authorization');
  const queryToken = c.req.query('token');
  const tokenStr = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : queryToken;

  if (!tokenStr) {
    return c.json({ error: 'Missing authorization' }, 401);
  }

  const token = tokenStr;
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  c.set('userId', data.user.id);
  c.set('userEmail', data.user.email ?? '');
  await next();
});
