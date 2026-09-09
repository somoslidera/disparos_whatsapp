import { handle, ok } from "@/lib/api";
import { getInstanceStatus, isConfigured } from "@/lib/uazapi";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  if (!isConfigured()) {
    return ok({ configured: false, connected: false, loggedIn: false, status: "not_configured" });
  }
  const status = await getInstanceStatus();
  return ok({ configured: true, ...status });
});
