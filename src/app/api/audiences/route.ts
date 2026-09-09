import { nanoid } from "nanoid";
import { fail, handle, ok } from "@/lib/api";
import { readDb, updateDb } from "@/lib/db";
import { audienceInputSchema } from "@/lib/schemas";
import { countAudience } from "@/lib/audiences";
import type { Audience } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const db = await readDb();
  const audiences = db.audiences.map((a) => ({ ...a, total: countAudience(a, db.audiences) }));
  return ok({ audiences });
});

export const POST = handle(async (req: Request) => {
  const parsed = audienceInputSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Dados inválidos");
  const now = new Date().toISOString();
  const audience: Audience = {
    id: nanoid(10),
    ...parsed.data,
    createdAt: now,
    updatedAt: now,
  };
  await updateDb((db) => {
    db.audiences.unshift(audience);
  });
  return ok({ audience }, { status: 201 });
});
