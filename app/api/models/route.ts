import { NextResponse } from "next/server";
import { ensureSchema, modelCount, readModelSummaryData, upsertProviderModels } from "@/lib/db";
import { loadModelBrowserData } from "@/lib/model-data";
import { PROVIDER_ENV_VARS, refreshProviderWithModels } from "@/lib/provider-refresh";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const populationErrors: string[] = [];

    let existingCount = await modelCount();
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

      existingCount = await modelCount();
    }

    if (existingCount === 0) {
      const providers = Object.keys(PROVIDER_ENV_VARS).sort();
      for (const provider of providers) {
        try {
          const { models } = await refreshProviderWithModels(provider);
          await upsertProviderModels(provider, models);
        } catch (error) {
          populationErrors.push(
            `${provider}: ${error instanceof Error ? error.message : "refresh failed"}`
          );
          continue;
        }
      }

      existingCount = await modelCount();
    }

    if (existingCount === 0 && populationErrors.length) {
      return NextResponse.json(
        {
          ok: false,
          error: `Database is empty after population attempts: ${populationErrors.join(" | ")}`
        },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider") ?? "all";
    const data = await readModelSummaryData(provider);

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
