import { NextResponse } from "next/server";
import { ensureSchema, readSingleModel } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await ensureSchema();

    const { searchParams } = new URL(request.url);
    const provider = (searchParams.get("provider") ?? "").trim().toLowerCase();
    const modelId = (searchParams.get("modelId") ?? "").trim();

    if (!provider || !modelId) {
      return NextResponse.json(
        { ok: false, error: "provider and modelId are required" },
        { status: 400 }
      );
    }

    const model = await readSingleModel(provider, modelId);
    if (!model) {
      return NextResponse.json({ ok: false, error: "Model not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, model });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to load model"
      },
      { status: 500 }
    );
  }
}
