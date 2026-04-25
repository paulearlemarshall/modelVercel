import type { ApiCallTiming, JsonValue, ModelRecord, ProviderRefreshResult } from "@/lib/model-types";

export const PROVIDER_ENV_VARS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  nvidia: "NVIDIA_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
  xai: "XAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  alibaba: "ALIBABA_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  openrouter: "OPENROUTER_API_KEY"
};

const OPENAI_COMPATIBLE = new Set([
  "openai",
  "nvidia",
  "xai",
  "deepseek",
  "alibaba",
  "moonshot",
  "openrouter"
]);

const BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
  fireworks: "https://api.fireworks.ai/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  xai: "https://api.x.ai/v1",
  deepseek: "https://api.deepseek.com",
  alibaba: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  moonshot: "https://api.moonshot.ai/v1",
  openrouter: "https://openrouter.ai/api/v1"
};

function safeModelId(model: Record<string, unknown>): string {
  for (const key of ["id", "name", "model", "model_id"]) {
    const value = model[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "<unknown-model-id>";
}

function toModelRecords(provider: string, payloadModels: Record<string, unknown>[]): ModelRecord[] {
  return payloadModels.map((model) => ({
    provider,
    id: safeModelId(model),
    supportsServerless: model.supportsServerless === true,
    model: model as { [key: string]: JsonValue }
  }));
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timings: ApiCallTiming[],
  label: string
): Promise<unknown> {
  const started = Date.now();
  const response = await fetch(url, init);
  const durationMs = Date.now() - started;

  if (!response.ok) {
    timings.push({ label, durationMs, status: response.status });
    const body = await response.text();
    throw new Error(`HTTP ${response.status} on ${label}: ${body.slice(0, 500)}`);
  }

  const data = (await response.json()) as unknown;

  const itemCount =
    Array.isArray(data)
      ? data.length
      : typeof data === "object" && data !== null && Array.isArray((data as { data?: unknown }).data)
        ? ((data as { data: unknown[] }).data.length ?? 0)
        : typeof data === "object" && data !== null && Array.isArray((data as { models?: unknown }).models)
          ? ((data as { models: unknown[] }).models.length ?? 0)
          : undefined;

  timings.push({
    label,
    durationMs,
    status: response.status,
    itemCount
  });

  return data;
}

function providerApiKey(provider: string): string {
  const envVar = PROVIDER_ENV_VARS[provider];
  const key = envVar ? process.env[envVar] : "";
  if (!key) {
    throw new Error(`Missing API key for ${provider}. Set ${envVar}.`);
  }
  return key;
}

function providerBaseUrl(provider: string): string {
  const url = BASE_URLS[provider];
  if (!url) {
    throw new Error(`Unsupported provider ${provider}`);
  }
  return url;
}

async function fetchProviderModels(provider: string, timings: ApiCallTiming[]): Promise<ModelRecord[]> {
  const apiKey = providerApiKey(provider);
  const baseUrl = providerBaseUrl(provider);

  if (OPENAI_COMPATIBLE.has(provider)) {
    const raw = await fetchJson(
      `${baseUrl}/models`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json"
        },
        cache: "no-store"
      },
      timings,
      `${provider}:list`
    );

    const list =
      Array.isArray(raw)
        ? raw
        : typeof raw === "object" && raw !== null && Array.isArray((raw as { data?: unknown }).data)
          ? ((raw as { data: unknown[] }).data ?? [])
          : [];

    const payloadModels = list.filter(
      (entry): entry is Record<string, unknown> => !!entry && typeof entry === "object" && !Array.isArray(entry)
    );

    return toModelRecords(provider, payloadModels);
  }

  if (provider === "anthropic") {
    const raw = await fetchJson(
      `${baseUrl}/models`,
      {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          Accept: "application/json"
        },
        cache: "no-store"
      },
      timings,
      "anthropic:list"
    );

    const list =
      typeof raw === "object" && raw !== null && Array.isArray((raw as { data?: unknown }).data)
        ? ((raw as { data: unknown[] }).data ?? [])
        : [];

    const payloadModels = list.filter(
      (entry): entry is Record<string, unknown> => !!entry && typeof entry === "object" && !Array.isArray(entry)
    );

    return toModelRecords(provider, payloadModels);
  }

  if (provider === "google") {
    const raw = await fetchJson(
      `${baseUrl}/models?key=${encodeURIComponent(apiKey)}`,
      {
        headers: {
          Accept: "application/json"
        },
        cache: "no-store"
      },
      timings,
      "google:list"
    );

    const list =
      typeof raw === "object" && raw !== null && Array.isArray((raw as { models?: unknown }).models)
        ? ((raw as { models: unknown[] }).models ?? [])
        : [];

    const payloadModels = list.filter(
      (entry): entry is Record<string, unknown> => !!entry && typeof entry === "object" && !Array.isArray(entry)
    );

    return toModelRecords(provider, payloadModels);
  }

  if (provider === "fireworks") {
    const payloadModels: Record<string, unknown>[] = [];
    let pageToken = "";
    let page = 1;

    while (true) {
      const query = pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : "";
      const raw = await fetchJson(
        `https://api.fireworks.ai/v1/accounts/fireworks/models${query}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json"
          },
          cache: "no-store"
        },
        timings,
        `fireworks:list:page:${page}`
      );

      const pageModels =
        typeof raw === "object" && raw !== null && Array.isArray((raw as { models?: unknown }).models)
          ? ((raw as { models: unknown[] }).models ?? [])
          : [];

      for (const model of pageModels) {
        if (model && typeof model === "object" && !Array.isArray(model)) {
          payloadModels.push(model as Record<string, unknown>);
        }
      }

      const nextToken =
        typeof raw === "object" && raw !== null && typeof (raw as { nextPageToken?: unknown }).nextPageToken === "string"
          ? ((raw as { nextPageToken: string }).nextPageToken ?? "")
          : "";

      if (!nextToken) {
        break;
      }

      pageToken = nextToken;
      page += 1;
    }

    return toModelRecords(provider, payloadModels);
  }

  throw new Error(`No model fetch implementation for ${provider}`);
}

export async function refreshProvider(provider: string): Promise<ProviderRefreshResult> {
  const started = Date.now();
  const apiCalls: ApiCallTiming[] = [];

  try {
    const models = await fetchProviderModels(provider, apiCalls);
    return {
      provider,
      ok: true,
      modelCount: models.length,
      totalDurationMs: Date.now() - started,
      apiCalls
    };
  } catch (error) {
    return {
      provider,
      ok: false,
      modelCount: 0,
      totalDurationMs: Date.now() - started,
      apiCalls,
      error: error instanceof Error ? error.message : "Unknown refresh error"
    };
  }
}

export async function fetchProviderRecords(provider: string): Promise<ModelRecord[]> {
  const timings: ApiCallTiming[] = [];
  return fetchProviderModels(provider, timings);
}

export async function refreshProviderWithModels(provider: string): Promise<{
  result: ProviderRefreshResult;
  models: ModelRecord[];
}> {
  const started = Date.now();
  const apiCalls: ApiCallTiming[] = [];

  const models = await fetchProviderModels(provider, apiCalls);
  return {
    models,
    result: {
      provider,
      ok: true,
      modelCount: models.length,
      totalDurationMs: Date.now() - started,
      apiCalls
    }
  };
}
