import { handle, ok } from "@/lib/api";
import { listContacts } from "@/lib/uazapi";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  return ok({ contacts: await listContacts() });
});
