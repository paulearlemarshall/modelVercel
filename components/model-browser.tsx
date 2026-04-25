"use client";

import { useEffect, useMemo, useState } from "react";
import type { ModelBrowserData, ModelRecord, RefreshResponse } from "@/lib/model-types";

const EMPTY_DATA: ModelBrowserData = { providers: [], models: [] };

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

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
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState<string>("");
  const [chatSending, setChatSending] = useState<boolean>(false);
  const [selectedFullModel, setSelectedFullModel] = useState<ModelRecord | null>(null);
  const [statusText, setStatusText] = useState<string>("Ready");
  const [lastInferenceMs, setLastInferenceMs] = useState<number | null>(null);

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
      setStatusText("Failed to load data from DB");
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
      setStatusText(`Refresh completed for ${payload.scope}`);
      await loadFromDb();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
      setStatusText("Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  async function sendChatMessage() {
    if (!selected) {
      setStatusText("No model selected for chat");
      return;
    }

    const content = chatInput.trim();
    if (!content || chatSending) {
      return;
    }

    const userMessage: ChatMessage = { role: "user", content };
    const nextMessages = [...chatMessages, userMessage];

    setChatInput("");
    setChatMessages(nextMessages);
    setChatSending(true);
    setStatusText(`Sending chat to ${selected.provider}:${selected.id}`);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selected.provider,
          modelId: selected.id,
          messages: nextMessages
        })
      });

      const payload = (await response.json()) as {
        ok: boolean;
        responseText?: string;
        inferenceMs?: number;
        error?: string;
      };

      if (!response.ok || !payload.ok || !payload.responseText) {
        throw new Error(payload.error ?? "Chat request failed");
      }

      setChatMessages((existing) => [...existing, { role: "assistant", content: payload.responseText ?? "" }]);
      setLastInferenceMs(payload.inferenceMs ?? null);
      setStatusText(`Inference complete: ${payload.inferenceMs ?? "n/a"} ms`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Chat failed";
      setChatMessages((existing) => [...existing, { role: "assistant", content: `Error: ${message}` }]);
      setStatusText("Inference failed");
    } finally {
      setChatSending(false);
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

  const activeModel =
    selectedFullModel && selected && selectedFullModel.provider === selected.provider && selectedFullModel.id === selected.id
      ? selectedFullModel
      : selected;

  const selectedKey = selected ? `${selected.provider}:${selected.id}` : "";

  useEffect(() => {
    if (selectedKey && selectedKey !== selectedId) {
      setSelectedId(selectedKey);
    }
  }, [selectedId, selectedKey]);

  useEffect(() => {
    setChatMessages([]);
    setChatInput("");
    setLastInferenceMs(null);
    setSelectedFullModel(null);
  }, [selectedKey]);

  useEffect(() => {
    const selectedProvider = selected?.provider;
    const selectedModelId = selected?.id;

    if (!selectedProvider || !selectedModelId) {
      setSelectedFullModel(null);
      return;
    }

    let cancelled = false;

    const loadSelectedModel = async () => {
      try {
        const response = await fetch(
          `/api/model?provider=${encodeURIComponent(selectedProvider)}&modelId=${encodeURIComponent(selectedModelId)}`,
          { cache: "no-store" }
        );
        const payload = (await response.json()) as {
          ok: boolean;
          model?: ModelRecord;
        };

        if (!cancelled && response.ok && payload.ok && payload.model) {
          setSelectedFullModel(payload.model);
        }
      } catch {
        if (!cancelled) {
          setSelectedFullModel(null);
        }
      }
    };

    void loadSelectedModel();

    return () => {
      cancelled = true;
    };
  }, [selected?.provider, selected?.id]);

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

      <section className="chat-panel">
        <h2>Chat</h2>
        <p>
          Model: <strong>{selected ? `${selected.provider}:${selected.id}` : "none selected"}</strong>
        </p>
        <div className="chat-history">
          {chatMessages.length ? (
            chatMessages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`chat-message ${message.role}`}>
                <span className="chat-role">{message.role === "user" ? "you" : "assistant"}</span>
                <p>{message.content}</p>
              </div>
            ))
          ) : (
            <p className="chat-empty">No messages yet. Send a prompt to start chatting.</p>
          )}
        </div>
        <div className="chat-input-row">
          <textarea
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            placeholder="Ask the selected model something..."
            rows={3}
            disabled={!selected || chatSending}
          />
          <button type="button" onClick={() => void sendChatMessage()} disabled={!selected || chatSending}>
            {chatSending ? "Sending..." : "Send"}
          </button>
        </div>
      </section>

      <section className="stats">
        <span>Visible: {visibleModels.length}</span>
        <span>Providers: {data.providers.length}</span>
        <span>Total loaded: {data.models.length}</span>
        <span>Source: Vercel Postgres</span>
        <span>Status: {statusText}</span>
        <span>Inference: {lastInferenceMs === null ? "n/a" : `${lastInferenceMs} ms`}</span>
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
          {activeModel ? (
            <>
              <div className="meta">
                <span>
                  <strong>Provider:</strong> {activeModel.provider}
                </span>
                <span>
                  <strong>Model:</strong> {activeModel.id}
                </span>
                <span>
                  <strong>Serverless:</strong> {activeModel.supportsServerless ? "yes" : "no"}
                </span>
                <span>
                  <strong>Input Tokens:</strong>{" "}
                  {formatNumber(activeModel.model.max_input_tokens ?? activeModel.model.inputTokenLimit)}
                </span>
                <span>
                  <strong>Output Tokens:</strong>{" "}
                  {formatNumber(activeModel.model.max_tokens ?? activeModel.model.outputTokenLimit)}
                </span>
              </div>

              <h3>Model metadata</h3>
              <pre>{JSON.stringify(activeModel.model, null, 2)}</pre>
              {activeModel.details ? (
                <>
                  <h3>Cached details</h3>
                  <pre>{JSON.stringify(activeModel.details, null, 2)}</pre>
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
