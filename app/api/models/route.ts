import { NextResponse } from "next/server";
import { ensureSchema, modelCount, readModelData, upsertProviderModels } from "@/lib/db";
import { loadModelBrowserData } from "@/lib/model-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await ensureSchema();

    const existingCount = await modelCount();
    if (existingCount === 0) {
      const seed = await loadModelBrowserData();
      const byProvider = new Map<string, typeof seed.models>();

      for (const model of seed.models) {
        const list = byProvider.get(model.provider) ?? [];
        list.push(model);
        byProvider.set(model.provider, list);
      }

      for (const [provider, records] of byProvider.entries()) {
        await upsertProviderModels(provider, records);
      }
    }

    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider") ?? "all";
    const data = await readModelData(provider);

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to load model data"
      },
      { status: 500 }
    );
  }
}
