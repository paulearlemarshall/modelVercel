import { NextResponse } from "next/server";
import { ensureSchema, upsertProviderModels } from "@/lib/db";
import { PROVIDER_ENV_VARS, refreshProviderWithModels } from "@/lib/provider-refresh";
import type { ProviderRefreshResult, RefreshResponse } from "@/lib/model-types";

export const dynamic = "force-dynamic";

type RefreshBody = {
  provider?: string;
};

export async function POST(request: Request) {
  const startedAt = new Date().toISOString();

  try {
    await ensureSchema();

    const body = (await request.json()) as RefreshBody;
    const requestedProvider = (body.provider ?? "all").toLowerCase();
    const providers = Object.keys(PROVIDER_ENV_VARS).sort();
    const scope = requestedProvider === "all" ? "all" : requestedProvider;

    const targets =
      scope === "all"
        ? providers
        : providers.includes(scope)
          ? [scope]
          : [];

    if (!targets.length) {
      return NextResponse.json(
        { ok: false, error: `Unknown provider scope '${requestedProvider}'` },
        { status: 400 }
      );
    }

    const providerResults: ProviderRefreshResult[] = [];

    for (const provider of targets) {
      try {
        const { models, result } = await refreshProviderWithModels(provider);
        await upsertProviderModels(provider, models);
        providerResults.push(result);
      } catch (error) {
        providerResults.push({
          provider,
          ok: false,
          modelCount: 0,
          totalDurationMs: 0,
          apiCalls: [],
          error: error instanceof Error ? error.message : "Refresh failed"
        });
      }
    }

    const response: RefreshResponse = {
      ok: providerResults.every((entry) => entry.ok),
      scope,
      startedAt,
      finishedAt: new Date().toISOString(),
      providerResults
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Refresh request failed",
        startedAt,
        finishedAt: new Date().toISOString(),
        providerResults: []
      },
      { status: 500 }
    );
  }
}
