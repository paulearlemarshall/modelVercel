export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ModelRecord = {
  provider: string;
  id: string;
  supportsServerless: boolean;
  model: { [key: string]: JsonValue };
  details?: { [key: string]: JsonValue };
};

export type ModelBrowserData = {
  providers: string[];
  models: ModelRecord[];
};

export type ApiCallTiming = {
  label: string;
  durationMs: number;
  status: number;
  itemCount?: number;
};

export type ProviderRefreshResult = {
  provider: string;
  ok: boolean;
  modelCount: number;
  totalDurationMs: number;
  apiCalls: ApiCallTiming[];
  error?: string;
};

export type RefreshResponse = {
  ok: boolean;
  scope: "all" | string;
  startedAt: string;
  finishedAt: string;
  providerResults: ProviderRefreshResult[];
};
