import { createHash } from "node:crypto";

/** Autenticação das rotas do agente: header Authorization: Bearer <DISPAROS_AGENT_KEY>. */

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Impressão curta e irreversível de uma chave (6 caracteres de SHA-256), para comparar chaves em log sem expô-las. */
function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 6);
}

export function agentKeyConfigured(): boolean {
  return Boolean((process.env.DISPAROS_AGENT_KEY || "").trim());
}

export function isAgentAuthorized(req: Request): boolean {
  const expected = (process.env.DISPAROS_AGENT_KEY || "").trim();
  if (expected.length < 16) return false;
  const header = req.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  let reason = "";
  if (!header) reason = "sem header Authorization";
  else if (!match) reason = `header sem "Bearer" (${header.trim().split(/\s+/)[0].slice(0, 12)}...)`;
  else {
    const got = match[1].trim().replace(/^["']|["']$/g, "");
    if (constantTimeEqual(got, expected)) return true;
    reason = `chave diferente (recebida ${fingerprint(got)} com ${got.length} caracteres, esperada ${fingerprint(expected)} com ${expected.length})`;
  }
  // Diagnóstico sem expor chaves: só o motivo e impressões de 6 caracteres.
  console.warn("[agente] acesso recusado:", reason, "·", new URL(req.url).pathname, "· user-agent:", (req.headers.get("user-agent") || "").slice(0, 40));
  return false;
}
