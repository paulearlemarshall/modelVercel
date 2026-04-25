import { promises as fs } from "node:fs";
import path from "node:path";
import type { JsonValue, ModelBrowserData, ModelRecord } from "@/lib/model-types";

type ProviderPayload = {
  models?: JsonValue[];
  details?: { [key: string]: JsonValue };
};

function safeModelId(model: { [key: string]: JsonValue }): string {
  for (const key of ["id", "name", "model", "model_id"]) {
    const value = model[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "<unknown-model-id>";
}

export async function loadModelBrowserData(): Promise<ModelBrowserData> {
  const root = process.cwd();
  const entries = await fs.readdir(root, { withFileTypes: true });
  const resultFiles = entries
    .filter((entry) => entry.isFile() && /^results_.+\.json$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  const models: ModelRecord[] = [];
  const providers = new Set<string>();

  for (const fileName of resultFiles) {
    const fullPath = path.join(root, fileName);
    const raw = await fs.readFile(fullPath, "utf8");
    const payload = JSON.parse(raw) as ProviderPayload;
    const provider = fileName
      .replace(/^results_/i, "")
      .replace(/\.json$/i, "")
      .toLowerCase();

    providers.add(provider);

    const sourceModels = Array.isArray(payload.models) ? payload.models : [];
    const details = payload.details ?? {};

    for (const entry of sourceModels) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }

      const model = entry as { [key: string]: JsonValue };
      const id = safeModelId(model);
      const maybeDetails = details[id];

      models.push({
        provider,
        id,
        supportsServerless: model.supportsServerless === true,
        model,
        details:
          maybeDetails && typeof maybeDetails === "object" && !Array.isArray(maybeDetails)
            ? (maybeDetails as { [key: string]: JsonValue })
            : undefined
      });
    }
  }

  models.sort((a, b) => {
    if (a.provider === b.provider) {
      return a.id.localeCompare(b.id);
    }
    return a.provider.localeCompare(b.provider);
  });

  return {
    providers: [...providers].sort(),
    models
  };
}
