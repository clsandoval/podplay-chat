import { Hono } from 'hono';
import type { AuthEnv } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';
import * as anthropic from '../lib/anthropic.js';
import type { ContentBlock } from '../lib/anthropic.js';
import { buildContentBlocks, type FileAttachment } from '../lib/file-processing.js';

const sessions = new Hono<AuthEnv>();

// List user's sessions
sessions.get('/', async (c) => {
  const userId = c.get('userId');
  const { data, error } = await supabase
    .from('chat_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('last_message_at', { ascending: false, nullsFirst: false });

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// Create a new session
sessions.post('/', async (c) => {
  const userId = c.get('userId');
  console.log(`[Session] Creating session for user ${userId}`);

  let session;
  try {
    session = await anthropic.createSession(
      process.env.AGENT_ID!,
      Number(process.env.AGENT_VERSION!),
      process.env.ENVIRONMENT_ID!,
      process.env.VAULT_ID!,
      process.env.GITHUB_TOKEN!,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: `Failed to create agent session: ${message}` }, 502);
  }

  const { error } = await supabase.from('chat_sessions').insert({
    user_id: userId,
    session_id: session.id,
    agent_id: process.env.AGENT_ID!,
    status: 'active',
  });

  if (error) {
    console.error(`[Session] Supabase insert error:`, error.message);
    return c.json({ error: error.message }, 500);
  }

  console.log(`[Session] Created ${session.id}, opening SSE stream...`);
  const { sessionManager } = await import('../lib/session-manager.js');
  sessionManager.connect(session.id);

  return c.json({ sessionId: session.id }, 201);
});

// Send a message
sessions.post('/:id/messages', async (c) => {
  const sessionId = c.req.param('id');
  const { text, attachments } = await c.req.json<{
    text: string;
    attachments?: FileAttachment[];
  }>();

  if (!text?.trim() && (!attachments || attachments.length === 0)) {
    return c.json({ error: 'text or attachments required' }, 400);
  }

  console.log(
    `[Message] Sending to ${sessionId}: "${(text || '').slice(0, 60)}..." ` +
      `(${attachments?.length ?? 0} files)`,
  );

  // Verify session belongs to user
  const userId = c.get('userId');
  const { data: row } = await supabase
    .from('chat_sessions')
    .select('session_id')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .single();

  if (!row) return c.json({ error: 'Session not found' }, 404);

  // Build content blocks
  const content: ContentBlock[] = [];
  if (text?.trim()) {
    content.push({ type: 'text', text });
  }
  if (attachments?.length) {
    const fileBlocks = await buildContentBlocks(attachments);
    content.push(...fileBlocks);

    // Record attachments in the database
    const rows = attachments.map((att) => ({
      user_id: userId,
      session_id: sessionId,
      file_name: att.fileName,
      file_path: att.storagePath,
      mime_type: att.mimeType,
      size_bytes: att.size,
    }));
    const { error: insertError } = await supabase
      .from('chat_attachments')
      .insert(rows);
    if (insertError) {
      console.error('[Message] Failed to record attachments:', insertError.message);
    }
  }

  await anthropic.sendMessage(sessionId, content);

  // Update last_message_at
  await supabase
    .from('chat_sessions')
    .update({ last_message_at: new Date().toISOString() })
    .eq('session_id', sessionId);

  return c.json({ status: 'sent' }, 202);
});

// Get chat history
sessions.get('/:id/history', async (c) => {
  const sessionId = c.req.param('id');
  const userId = c.get('userId');

  const { data: row } = await supabase
    .from('chat_sessions')
    .select('session_id')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .single();

  if (!row) return c.json({ error: 'Session not found' }, 404);

  const events = await anthropic.listEvents(sessionId);

  // Filter to conversation-relevant events
  const relevant = events.data.filter((e: any) =>
    ['user.message', 'agent.message', 'agent.tool_use', 'agent.tool_result',
     'agent.mcp_tool_use', 'agent.mcp_tool_result'].includes(e.type)
  );

  return c.json(relevant);
});

// Archive a session
sessions.delete('/:id', async (c) => {
  const sessionId = c.req.param('id');
  const userId = c.get('userId');

  const { data: row } = await supabase
    .from('chat_sessions')
    .select('session_id')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .single();

  if (!row) return c.json({ error: 'Session not found' }, 404);

  // Disconnect the in-memory SSE connection before archiving
  const { sessionManager } = await import('../lib/session-manager.js');
  sessionManager.disconnect(sessionId);

  await anthropic.archiveSession(sessionId);
  await supabase
    .from('chat_sessions')
    .update({ status: 'archived' })
    .eq('session_id', sessionId);

  return c.json({ status: 'archived' });
});

export { sessions };
