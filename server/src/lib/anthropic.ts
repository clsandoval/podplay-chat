const BASE_URL = 'https://api.anthropic.com/v1';

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } };

const headers = () => ({
  'x-api-key': process.env.ANTHROPIC_API_KEY!,
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'managed-agents-2026-04-01',
  'content-type': 'application/json',
});

export async function createSession(agentId: string, agentVersion: number, environmentId: string, vaultId: string, githubToken: string) {
  const res = await fetch(`${BASE_URL}/sessions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      agent: { type: 'agent', id: agentId, version: agentVersion },
      environment_id: environmentId,
      vault_ids: [vaultId],
      resources: [{
        type: 'github_repository',
        url: 'https://github.com/clsandoval/podplay-data',
        authorization_token: githubToken,
        mount_path: '/workspace/podplay-data',
        checkout: { type: 'branch', name: 'main' },
      }],
    }),
  });
  if (!res.ok) throw new Error(`Create session failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function sendMessage(sessionId: string, content: ContentBlock[]) {
  const res = await fetch(`${BASE_URL}/sessions/${sessionId}/events`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      events: [{ type: 'user.message', content }],
    }),
  });
  if (!res.ok) throw new Error(`Send message failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function listEvents(sessionId: string) {
  const allEvents: any[] = [];
  let url: string | null = `${BASE_URL}/sessions/${sessionId}/events`;

  while (url) {
    const res: Response = await fetch(url, { headers: headers() });
    if (!res.ok) throw new Error(`List events failed: ${res.status} ${await res.text()}`);
    const page: any = await res.json();
    allEvents.push(...(page.data ?? []));
    url = page.next_page ?? null;
  }

  return { data: allEvents };
}

export function streamUrl(sessionId: string) {
  return `${BASE_URL}/sessions/${sessionId}/events/stream`;
}

export function streamHeaders() {
  return { ...headers(), Accept: 'text/event-stream' };
}

export async function archiveSession(sessionId: string) {
  const res = await fetch(`${BASE_URL}/sessions/${sessionId}/archive`, {
    method: 'POST',
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Archive session failed: ${res.status} ${await res.text()}`);
  return res.json();
}
