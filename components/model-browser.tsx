"use client";

import { useEffect, useMemo, useState } from "react";
import type { ModelBrowserData, ModelRecord } from "@/lib/model-data";

type ModelBrowserProps = {
  data: ModelBrowserData;
};

function toSearchBlob(model: ModelRecord): string {
  return JSON.stringify(model).toLowerCase();
}

function formatNumber(value: unknown): string {
  return typeof value === "number" ? value.toLocaleString() : "n/a";
}

export default function ModelBrowser({ data }: ModelBrowserProps) {
  const [provider, setProvider] = useState<string>("all");
  const [query, setQuery] = useState<string>("");
  const [serverlessOnly, setServerlessOnly] = useState<boolean>(false);
  const [selectedId, setSelectedId] = useState<string>(data.models[0]?.id ?? "");

  const visibleModels = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.models.filter((model) => {
      if (provider !== "all" && model.provider !== provider) {
        return false;
      }

      if (serverlessOnly && !model.supportsServerless) {
        return false;
      }

      if (!q) {
        return true;
      }

      return (
        model.provider.includes(q) ||
        model.id.toLowerCase().includes(q) ||
        toSearchBlob(model).includes(q)
      );
    });
  }, [data.models, provider, query, serverlessOnly]);

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
        <p>Next.js + Vercel version of your model explorer TUI.</p>
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
            placeholder="model id, provider, or any field"
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
      </section>

      <section className="stats">
        <span>Visible: {visibleModels.length}</span>
        <span>Providers: {data.providers.length}</span>
        <span>Total loaded: {data.models.length}</span>
      </section>

      <section className="grid">
        <aside className="panel list-panel">
          <h2>Models</h2>
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

              <h3>JSON payload</h3>
              <pre>{JSON.stringify(selected.details ?? selected.model, null, 2)}</pre>
            </>
          ) : (
            <p>No models match the current filters.</p>
          )}
        </section>
      </section>
    </main>
  );
}
