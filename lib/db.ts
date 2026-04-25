import { neon } from "@neondatabase/serverless";
import type { JsonValue, ModelBrowserData, ModelRecord } from "@/lib/model-types";

type Row = {
  provider: string;
  model_id: string;
  supports_serverless: boolean;
  model_json: { [key: string]: JsonValue };
  details_json: { [key: string]: JsonValue } | null;
};

let schemaReady = false;

function connectionString(): string {
  const url =
    process.env.NEON_DATABASE_URL ?? process.env.POSTGRES_URL ?? process.env.DATABASE_URL ?? "";
  if (!url) {
    throw new Error("Missing database URL. Set NEON_DATABASE_URL (or POSTGRES_URL / DATABASE_URL).");
  }
  return url;
}

function sqlClient() {
  return neon(connectionString());
}

export async function ensureSchema(): Promise<void> {
  if (schemaReady) {
    return;
  }

  const sql = sqlClient();
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
  const sql = sqlClient();
  await sql`DELETE FROM model_inventory WHERE provider = ${provider};`;
}

export async function upsertProviderModels(provider: string, models: ModelRecord[]): Promise<void> {
  const sql = sqlClient();

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
  const sql = sqlClient();
  const rows = (providerScope && providerScope !== "all"
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
      `) as unknown as Row[];

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
  const sql = sqlClient();
  const rows = (await sql`SELECT COUNT(*)::text AS count FROM model_inventory;`) as unknown as {
    count: string;
  }[];
  return Number(rows[0]?.count ?? "0");
}
