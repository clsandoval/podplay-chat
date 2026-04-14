import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export async function fetchDirectory(path: string): Promise<any[]> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const res = await fetch(`${API_URL}/api/github/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) throw new Error(`GitHub fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchFile(path: string): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const res = await fetch(`${API_URL}/api/github/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) throw new Error(`GitHub fetch failed: ${res.status}`);
  const file = await res.json();

  // GitHub Contents API returns base64-encoded content
  return atob(file.content);
}
