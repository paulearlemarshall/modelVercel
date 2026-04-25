"use client";

import { useEffect, useMemo, useState } from "react";
import type { ModelBrowserData, ModelRecord, RefreshResponse } from "@/lib/model-types";

const EMPTY_DATA: ModelBrowserData = { providers: [], models: [] };

function formatNumber(value: unknown): string {
  return typeof value === "number" ? value.toLocaleString() : "n/a";
}

export default function ModelBrowser() {
  const [data, setData] = useState<ModelBrowserData>(EMPTY_DATA);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [refreshResult, setRefreshResult] = useState<RefreshResponse | null>(null);
  const [provider, setProvider] = useState<string>("all");
  const [query, setQuery] = useState<string>("");
  const [serverlessOnly, setServerlessOnly] = useState<boolean>(false);
  const [selectedId, setSelectedId] = useState<string>(
    data.models[0] ? `${data.models[0].provider}:${data.models[0].id}` : ""
  );

  async function loadFromDb() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/models?provider=all`, { cache: "no-store" });
      const payload = (await response.json()) as {
        ok: boolean;
        data?: ModelBrowserData;
        error?: string;
      };

      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error ?? "Failed to load models from DB");
      }

      setData(payload.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  async function refreshProviderScope() {
    setRefreshing(true);
    setError("");
    try {
      const response = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider })
      });

      const payload = (await response.json()) as RefreshResponse & { error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Refresh failed");
      }

      setRefreshResult(payload);
      await loadFromDb();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadFromDb();
  }, []);

  const providerScopedModels = useMemo(() => {
    return data.models.filter((model) => {
      if (provider !== "all" && model.provider !== provider) {
        return false;
      }

      if (serverlessOnly && !model.supportsServerless) {
        return false;
      }

      return true;
    });
  }, [data.models, provider, serverlessOnly]);

  const visibleModels = useMemo(() => {
    const q = query.toLowerCase();
    return providerScopedModels.filter((model) => {
      if (!q) {
        return true;
      }

      const rowText = `${model.provider} ${model.id}`.toLowerCase();
      return rowText.includes(q);
    });
  }, [providerScopedModels, query]);

  const selected =
    visibleModels.find((model) => `${model.provider}:${model.id}` === selectedId) ??
    visibleModels[0] ??
    null;

  const selectedKey = selected ? `${selected.provider}:${selected.id}` : "";

  useEffect(() => {
    if (selectedKey && selectedKey !== selectedId) {
      setSelectedId(selectedKey);
    }
  }, [selectedId, selectedKey]);

  return (
    <main className="page">
      <header className="hero">
        <h1>Model Browser</h1>
        <p>Neon-backed model inventory with provider refresh timings.</p>
      </header>

      <section className="controls">
        <label>
          Provider
          <select value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value="all">all</option>
            {data.providers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Search
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="type to filter current model list"
          />
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            checked={serverlessOnly}
            onChange={(event) => setServerlessOnly(event.target.checked)}
          />
          Serverless only
        </label>

        <div className="actions">
          <button type="button" onClick={() => void loadFromDb()} disabled={loading || refreshing}>
            Reload from DB
          </button>
          <button type="button" onClick={() => void refreshProviderScope()} disabled={loading || refreshing}>
            {refreshing ? "Refreshing..." : provider === "all" ? "Refresh all providers" : `Refresh ${provider}`}
          </button>
        </div>
      </section>

      {error ? <section className="error">{error}</section> : null}

      {refreshResult ? (
        <section className="refresh-panel">
          <h2>Last refresh</h2>
          <p>
            Scope: <strong>{refreshResult.scope}</strong> | Started: {new Date(refreshResult.startedAt).toLocaleString()} |
            Finished: {new Date(refreshResult.finishedAt).toLocaleString()}
          </p>
          <ul>
            {refreshResult.providerResults.map((entry) => (
              <li key={entry.provider}>
                [{entry.provider}] {entry.ok ? "ok" : "failed"} | models: {entry.modelCount} | total: {entry.totalDurationMs}
                ms
                {entry.error ? ` | error: ${entry.error}` : ""}
                {entry.apiCalls.length
                  ? ` | calls: ${entry.apiCalls
                      .map((call) => `${call.label} ${call.durationMs}ms ${call.itemCount ?? ""}`.trim())
                      .join("; ")}`
                  : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="stats">
        <span>Visible: {visibleModels.length}</span>
        <span>Providers: {data.providers.length}</span>
        <span>Total loaded: {data.models.length}</span>
        <span>Source: Neon DB</span>
      </section>

      <section className="grid">
        <aside className="panel list-panel">
          <h2>Models</h2>
          {loading ? <p>Loading model data...</p> : null}
          <ul>
            {visibleModels.map((model) => {
              const key = `${model.provider}:${model.id}`;
              const isSelected = key === selectedKey;
              return (
                <li key={key}>
                  <button
                    className={isSelected ? "row selected" : "row"}
                    onClick={() => setSelectedId(key)}
                    type="button"
                  >
                    <span className="provider">[{model.provider}]</span>
                    <span className="model-id">{model.id}</span>
                    {model.supportsServerless ? <span className="badge">serverless</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="panel detail-panel">
          <h2>Details</h2>
          {selected ? (
            <>
              <div className="meta">
                <span>
                  <strong>Provider:</strong> {selected.provider}
                </span>
                <span>
                  <strong>Model:</strong> {selected.id}
                </span>
                <span>
                  <strong>Serverless:</strong> {selected.supportsServerless ? "yes" : "no"}
                </span>
                <span>
                  <strong>Input Tokens:</strong>{" "}
                  {formatNumber(selected.model.max_input_tokens ?? selected.model.inputTokenLimit)}
                </span>
                <span>
                  <strong>Output Tokens:</strong>{" "}
                  {formatNumber(selected.model.max_tokens ?? selected.model.outputTokenLimit)}
                </span>
              </div>

              <h3>Model metadata</h3>
              <pre>{JSON.stringify(selected.model, null, 2)}</pre>
              {selected.details ? (
                <>
                  <h3>Cached details</h3>
                  <pre>{JSON.stringify(selected.details, null, 2)}</pre>
                </>
              ) : null}
            </>
          ) : (
            <p>{loading ? "Loading..." : "No models match the current filters."}</p>
          )}
        </section>
      </section>
    </main>
  );
}
