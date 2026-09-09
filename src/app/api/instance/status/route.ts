import { getCreds, handle, hasEnvCreds, ok } from "@/lib/api";
import { getInstanceStatus } from "@/lib/uazapi";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const creds = getCreds(req);
  if (!creds.url || !creds.token) {
    return ok({ configured: false, envConfigured: hasEnvCreds(), connected: false, loggedIn: false, status: "not_configured" });
  }
  const status = await getInstanceStatus(creds);
  return ok({ configured: true, envConfigured: hasEnvCreds(), ...status });
});
