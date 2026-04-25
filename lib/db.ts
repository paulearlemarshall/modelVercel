import { sql } from "@vercel/postgres";
import type { JsonValue, ModelBrowserData, ModelRecord } from "@/lib/model-types";

type Row = {
  provider: string;
  model_id: string;
  supports_serverless: boolean;
  model_json: { [key: string]: JsonValue };
  details_json: { [key: string]: JsonValue } | null;
};

let schemaReady = false;

export async function ensureSchema(): Promise<void> {
  if (schemaReady) {
    return;
  }

  await sql`
    CREATE TABLE IF NOT EXISTS model_inventory (
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      supports_serverless BOOLEAN NOT NULL DEFAULT FALSE,
      model_json JSONB NOT NULL,
      details_json JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (provider, model_id)
    );
  `;

  schemaReady = true;
}

export async function clearProvider(provider: string): Promise<void> {
  await sql`DELETE FROM model_inventory WHERE provider = ${provider};`;
}

export async function upsertProviderModels(provider: string, models: ModelRecord[]): Promise<void> {
  await clearProvider(provider);

  if (!models.length) {
    return;
  }

  for (const model of models) {
    await sql`
      INSERT INTO model_inventory (
        provider,
        model_id,
        supports_serverless,
        model_json,
        details_json,
        updated_at
      ) VALUES (
        ${provider},
        ${model.id},
        ${model.supportsServerless},
        ${JSON.stringify(model.model)},
        ${JSON.stringify(model.details ?? null)},
        NOW()
      );
    `;
  }
}

export async function readModelData(providerScope?: string): Promise<ModelBrowserData> {
  const result = providerScope && providerScope !== "all"
    ? await sql`
        SELECT provider, model_id, supports_serverless, model_json, details_json
        FROM model_inventory
        WHERE provider = ${providerScope}
        ORDER BY provider, model_id;
      `
    : await sql`
        SELECT provider, model_id, supports_serverless, model_json, details_json
        FROM model_inventory
        ORDER BY provider, model_id;
      `;
  const rows = result.rows as Row[];

  const models: ModelRecord[] = rows.map((row) => ({
    provider: row.provider,
    id: row.model_id,
    supportsServerless: row.supports_serverless,
    model: row.model_json,
    details: row.details_json ?? undefined
  }));

  const providers = [...new Set(models.map((entry) => entry.provider))].sort();

  return { providers, models };
}

export async function modelCount(): Promise<number> {
  const rows = (await sql`SELECT COUNT(*)::text AS count FROM model_inventory;`).rows as {
    count: string;
  }[];
  return Number(rows[0]?.count ?? "0");
}
