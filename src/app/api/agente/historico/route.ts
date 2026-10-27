import { handle, ok } from "@/lib/api";
import { listLog, storeAvailable } from "@/lib/agent-store";

export const dynamic = "force-dynamic";

/** Histórico dos envios do agente para a tela Histórico (protegido pela senha do app, quando configurada). */
export const GET = handle(async (req: Request) => {
  if (!storeAvailable(req)) return ok({ envios: [], disponivel: false });
  const envios = await listLog(req, 100);
  return ok({ envios, disponivel: true });
});
