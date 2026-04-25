#!/usr/bin/env python3
"""Refactored nvidia_models.py to use the modular ModelFetcher system."""

import argparse
import json
import os
import sys
from typing import Any, Dict

from model_fetcher import PROVIDER_ENV_VARS, ProviderFactory

PROVIDER_NAMES = sorted(PROVIDER_ENV_VARS.keys())


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fetch model list and model details using the modular fetcher system."
    )
    parser.add_argument(
        "--provider",
        choices=PROVIDER_NAMES,
        default="nvidia",
        help="Provider to fetch models from (default: nvidia)",
    )
    parser.add_argument(
        "--api-key",
        help="API key for the provider. If omitted, will check relevant env var.",
    )
    parser.add_argument(
        "--output",
        help="Write JSON output to this file path.",
    )
    parser.add_argument(
        "--include-details",
        action="store_true",
        default=False,
        help="Also fetch detail for each model (can be slow).",
    )
    
    args = parser.parse_args()

    env_var = PROVIDER_ENV_VARS.get(args.provider)
    api_key = args.api_key or (os.getenv(env_var) if env_var else None)

    if not api_key:
        print(f"Error: Missing API key for provider '{args.provider}'. Set {env_var} or use --api-key.")
        return 1

    try:
        provider = ProviderFactory.get_provider(args.provider, api_key)
        models = provider.fetch_models()

        details = {}
        if args.include_details:
            print(f"Fetching details for {len(models)} models...")
            for i, model in enumerate(models):
                model_id = provider.get_model_id(model)
                if model_id:
                    print(f"[{i+1}/{len(models)}] {model_id}", end="\r")
                    try:
                        details[model_id] = provider.fetch_model_details(model_id)
                    except Exception as e:
                        print(f"\nError fetching details for {model_id}: {e}")
            print("\nDone fetching details.")

        result: Dict[str, Any] = {
            "provider": args.provider,
            "model_count": len(models),
            "models": models,
        }
        
        if details:
            result["details"] = details

        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2, ensure_ascii=False)
            print(f"Saved results to {args.output}")
        else:
            print(json.dumps(result, indent=2, ensure_ascii=False))

        return 0
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())