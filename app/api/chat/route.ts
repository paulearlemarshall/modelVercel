import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type ChatBody = {
  provider?: string;
  modelId?: string;
  messages?: ChatMessage[];
};

function normalizeRole(role: string): ChatMessage["role"] {
  if (role === "assistant") {
    return "assistant";
  }
  if (role === "system") {
    return "system";
  }
  return "user";
}

const OPENAI_CHAT_BASE: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
  xai: "https://api.x.ai/v1",
  deepseek: "https://api.deepseek.com",
  alibaba: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  moonshot: "https://api.moonshot.ai/v1",
  openrouter: "https://openrouter.ai/api/v1"
};

const PROVIDER_KEYS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  nvidia: "NVIDIA_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GEMINI_API_KEY",
  gemini: "GEMINI_API_KEY",
  xai: "XAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  alibaba: "ALIBABA_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  openrouter: "OPENROUTER_API_KEY"
};

function requireApiKey(provider: string): string {
  const envVar = PROVIDER_KEYS[provider];
  const value = envVar ? process.env[envVar] : "";
  if (!value) {
    throw new Error(`Missing API key for ${provider}. Set ${envVar}.`);
  }
  return value;
}

function extractOpenAIText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return "";
  }

  const first = choices[0];
  if (!first || typeof first !== "object") {
    return "";
  }

  const message = (first as { message?: unknown }).message;
  if (message && typeof message === "object") {
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      const parts = content
        .map((item) => {
          if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
            return (item as { text: string }).text;
          }
          return "";
        })
        .filter(Boolean);
      if (parts.length) {
        return parts.join("\n");
      }
    }
  }

  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

function extractAnthropicText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return "";
  }

  const text = content
    .map((item) => {
      if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
        return (item as { text: string }).text;
      }
      return "";
    })
    .filter(Boolean);

  return text.join("\n");
}

function extractGoogleText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return "";
  }

  const first = candidates[0];
  if (!first || typeof first !== "object") {
    return "";
  }

  const content = (first as { content?: unknown }).content;
  if (!content || typeof content !== "object") {
    return "";
  }

  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .map((item) => {
      if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
        return (item as { text: string }).text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

async function callOpenAICompatible(provider: string, modelId: string, messages: ChatMessage[]): Promise<string> {
  const apiKey = requireApiKey(provider);
  const baseUrl = OPENAI_CHAT_BASE[provider];
  if (!baseUrl) {
    throw new Error(`Chat provider not supported: ${provider}`);
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      model: modelId,
      messages,
      max_tokens: 800,
      temperature: 0.7
    }),
    cache: "no-store"
  });

  const data = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(`Chat failed (${response.status}): ${JSON.stringify(data).slice(0, 500)}`);
  }

  return extractOpenAIText(data) || JSON.stringify(data);
}

async function callAnthropic(modelId: string, messages: ChatMessage[]): Promise<string> {
  const apiKey = requireApiKey("anthropic");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 800,
      messages: messages.map((msg) => ({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: msg.content
      }))
    }),
    cache: "no-store"
  });

  const data = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(`Chat failed (${response.status}): ${JSON.stringify(data).slice(0, 500)}`);
  }

  return extractAnthropicText(data) || JSON.stringify(data);
}

async function callGoogle(modelId: string, messages: ChatMessage[]): Promise<string> {
  const apiKey = requireApiKey("google");
  const path = modelId.startsWith("models/") ? modelId : `models/${modelId}`;
  const encodedPath = encodeURIComponent(path).replace(/%2F/g, "/");
  const url = `https://generativelanguage.googleapis.com/v1beta/${encodedPath}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      contents: messages.map((msg) => ({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }]
      }))
    }),
    cache: "no-store"
  });

  const data = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(`Chat failed (${response.status}): ${JSON.stringify(data).slice(0, 500)}`);
  }

  return extractGoogleText(data) || JSON.stringify(data);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatBody;
    const provider = (body.provider ?? "").toLowerCase();
    const modelId = (body.modelId ?? "").trim();
    const rawMessages = Array.isArray(body.messages) ? body.messages : [];

    if (!provider || !modelId) {
      return NextResponse.json({ ok: false, error: "provider and modelId are required" }, { status: 400 });
    }

    const messages: ChatMessage[] = rawMessages
      .map((msg) => ({
        role: normalizeRole(String(msg.role ?? "user")),
        content: String(msg.content ?? "").trim()
      }))
      .filter((msg) => msg.content);

    if (!messages.length) {
      return NextResponse.json({ ok: false, error: "messages are required" }, { status: 400 });
    }

    const start = Date.now();
    let responseText = "";

    if (provider === "anthropic") {
      responseText = await callAnthropic(modelId, messages);
    } else if (provider === "google" || provider === "gemini") {
      responseText = await callGoogle(modelId, messages);
    } else {
      responseText = await callOpenAICompatible(provider, modelId, messages);
    }

    return NextResponse.json({
      ok: true,
      provider,
      modelId,
      responseText,
      inferenceMs: Date.now() - start
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Chat request failed"
      },
      { status: 500 }
    );
  }
}
