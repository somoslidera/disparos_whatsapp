import { getCreds, handle, ok } from "@/lib/api";
import { listContacts } from "@/lib/uazapi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = handle(async (req: Request) => {
  return ok({ contacts: await listContacts(getCreds(req)) });
});
