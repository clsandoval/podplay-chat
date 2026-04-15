import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? '';
}

async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getToken();
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
}

export interface FileAttachment {
  fileName: string;
  mimeType: string;
  storagePath: string;
  size: number;
}

export async function createSession(): Promise<{ sessionId: string }> {
  const res = await authFetch('/api/sessions', { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);
  return res.json();
}

export async function sendMessage(
  sessionId: string,
  text: string,
  attachments?: FileAttachment[],
): Promise<void> {
  const res = await authFetch(`/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text, attachments }),
  });
  if (!res.ok) throw new Error(`Failed to send message: ${res.status}`);
}

export async function getHistory(sessionId: string): Promise<any[]> {
  const res = await authFetch(`/api/sessions/${sessionId}/history`);
  if (!res.ok) throw new Error(`Failed to get history: ${res.status}`);
  return res.json();
}

export async function listSessions(): Promise<any[]> {
  const res = await authFetch('/api/sessions');
  if (!res.ok) throw new Error(`Failed to list sessions: ${res.status}`);
  return res.json();
}

export async function archiveSession(sessionId: string): Promise<void> {
  const res = await authFetch(`/api/sessions/${sessionId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to archive session: ${res.status}`);
}
