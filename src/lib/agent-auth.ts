/** Autenticação das rotas do agente: header Authorization: Bearer <DISPAROS_AGENT_KEY>. */

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function agentKeyConfigured(): boolean {
  return Boolean((process.env.DISPAROS_AGENT_KEY || "").trim());
}

export function isAgentAuthorized(req: Request): boolean {
  const expected = (process.env.DISPAROS_AGENT_KEY || "").trim();
  if (expected.length < 16) return false;
  const header = req.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;
  return constantTimeEqual(match[1].trim(), expected);
}
