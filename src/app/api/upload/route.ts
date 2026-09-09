import { fail, handle, ok } from "@/lib/api";
import { saveUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return fail("Envie um arquivo no campo 'file'.");
  const attachment = await saveUpload(file);
  return ok({ attachment }, { status: 201 });
});
