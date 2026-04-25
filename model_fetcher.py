#!/usr/bin/env python3
"""Modular model fetcher for multiple AI providers."""

import abc
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Set


class ModelProvider(abc.ABC):
    """Abstract base class for all model providers."""

    def __init__(self, api_key: str, base_url: Optional[str] = None, timeout: int = 30):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/") if base_url else self.get_default_base_url()
        self.timeout = timeout

    @abc.abstractmethod
    def get_default_base_url(self) -> str:
        """Return the default base URL for this provider."""
        pass

    @abc.abstractmethod
    def fetch_models(self) -> List[Dict[str, Any]]:
        """Fetch the list of models from the provider."""
        pass

    @abc.abstractmethod
    def fetch_model_details(self, model_id: str) -> Dict[str, Any]:
        """Fetch detailed information for a specific model."""
        pass

    def api_get(self, url: str, headers: Dict[str, str], retries: int = 3) -> Any:
        """Perform an authenticated GET request."""
        for attempt in range(1, retries + 1):
            req = urllib.request.Request(url, headers=headers, method="GET")
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as response:
                    payload = response.read().decode("utf-8")
                    return json.loads(payload)
            except urllib.error.HTTPError as exc:
                body = exc.read().decode("utf-8", errors="replace")
                if exc.code in (429, 500, 502, 503, 504) and attempt < retries:
                    sleep_seconds = min(2**attempt, 8)
                    time.sleep(sleep_seconds)
                    continue
                raise RuntimeError(f"HTTP {exc.code} for {url}\nResponse body: {body}") from exc
            except urllib.error.URLError as exc:
                if attempt < retries:
                    sleep_seconds = min(2**attempt, 8)
                    time.sleep(sleep_seconds)
                    continue
                raise RuntimeError(f"Network error while calling {url}: {exc}") from exc

    def get_model_id(self, model: Dict[str, Any]) -> Optional[str]:
        """Generic method to extract model ID from a model dictionary."""
        for key in ("id", "name", "model", "model_id"):
            value = model.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None


class OpenAICompatibleProvider(ModelProvider):
    """Provider for OpenAI, Nvidia, Fireworks, etc."""

    def get_default_base_url(self) -> str:
        return "https://api.openai.com/v1"

    def fetch_models(self) -> List[Dict[str, Any]]:
        url = f"{self.base_url}/models"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
        }
        payload = self.api_get(url, headers)
        
        if isinstance(payload, list):
            return [m for m in payload if isinstance(m, dict)]
        if isinstance(payload, dict):
            data = payload.get("data")
            if isinstance(data, list):
                return [m for m in data if isinstance(m, dict)]
        return []

    def fetch_model_details(self, model_id: str) -> Dict[str, Any]:
        encoded_id = urllib.parse.quote(model_id, safe="/")
        url = f"{self.base_url}/models/{encoded_id}"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
        }
        payload = self.api_get(url, headers)
        return payload if isinstance(payload, dict) else {}


class FireworksProvider(ModelProvider):
    """Provider for Fireworks AI."""

    def get_default_base_url(self) -> str:
        return "https://api.fireworks.ai/v1"

    def fetch_models(self) -> List[Dict[str, Any]]:
        all_models: List[Dict[str, Any]] = []
        page = 1
        while True:
            url = "https://api.fireworks.ai/v1/accounts/fireworks/models"
            if page > 1:
                url = f"{url}?pageToken={page}"
            payload = self.api_get(url, {"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"})
            if isinstance(payload, dict):
                models = payload.get("models")
                if isinstance(models, list):
                    all_models.extend(m for m in models if isinstance(m, dict))
                if not payload.get("nextPageToken"):
                    break
            else:
                break
            page += 1
        return all_models

    def fetch_model_details(self, model_id: str) -> Dict[str, Any]:
        url = f"{self.base_url}/{model_id}"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
        }
        payload = self.api_get(url, headers)
        return payload if isinstance(payload, dict) else {}


class AnthropicProvider(ModelProvider):
    """Provider for Anthropic."""

    def get_default_base_url(self) -> str:
        return "https://api.anthropic.com/v1"

    def fetch_models(self) -> List[Dict[str, Any]]:
        url = f"{self.base_url}/models"
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "Accept": "application/json",
        }
        payload = self.api_get(url, headers)
        
        if isinstance(payload, dict):
            data = payload.get("data")
            if isinstance(data, list):
                return [m for m in data if isinstance(m, dict)]
        return []

    def fetch_model_details(self, model_id: str) -> Dict[str, Any]:
        encoded_id = urllib.parse.quote(model_id, safe="/")
        url = f"{self.base_url}/models/{encoded_id}"
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "Accept": "application/json",
        }
        payload = self.api_get(url, headers)
        return payload if isinstance(payload, dict) else {}


class GoogleGeminiProvider(ModelProvider):
    """Provider for Google Gemini (Google AI Studio)."""

    def get_default_base_url(self) -> str:
        return "https://generativelanguage.googleapis.com/v1beta"

    def fetch_models(self) -> List[Dict[str, Any]]:
        # Google uses API key in query param or header
        url = f"{self.base_url}/models?key={self.api_key}"
        headers = {
            "Accept": "application/json",
        }
        payload = self.api_get(url, headers)
        
        if isinstance(payload, dict):
            models = payload.get("models")
            if isinstance(models, list):
                return [m for m in models if isinstance(m, dict)]
        return []

    def fetch_model_details(self, model_id: str) -> Dict[str, Any]:
        # Google uses resource names like 'models/gemini-pro'
        # If it doesn't start with models/, we might need to add it, but usually the list has them
        path = model_id if model_id.startswith("models/") else f"models/{model_id}"
        encoded_path = urllib.parse.quote(path, safe="models/")
        url = f"{self.base_url}/{encoded_path}?key={self.api_key}"
        headers = {
            "Accept": "application/json",
        }
        payload = self.api_get(url, headers)
        return payload if isinstance(payload, dict) else {}


class ProviderFactory:
    """Factory to create provider instances."""

    _PROVIDERS = {
        "openai": OpenAICompatibleProvider,
        "nvidia": OpenAICompatibleProvider,
        "fireworks": FireworksProvider,
        "anthropic": AnthropicProvider,
        "google": GoogleGeminiProvider,
        "gemini": GoogleGeminiProvider,
        "xai": OpenAICompatibleProvider,
        "deepseek": OpenAICompatibleProvider,
        "alibaba": OpenAICompatibleProvider,
        "moonshot": OpenAICompatibleProvider,
        "openrouter": OpenAICompatibleProvider,
    }

    _DEFAULT_URLS = {
        "nvidia": "https://integrate.api.nvidia.com/v1",
        "fireworks": "https://api.fireworks.ai/inference/v1",
        "xai": "https://api.x.ai/v1",
        "deepseek": "https://api.deepseek.com",
        "alibaba": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        "moonshot": "https://api.moonshot.ai/v1",
        "openrouter": "https://openrouter.ai/api/v1",
    }

    @classmethod
    def get_provider(cls, name: str, api_key: str, base_url: Optional[str] = None) -> ModelProvider:
        provider_cls = cls._PROVIDERS.get(name.lower())
        if not provider_cls:
            raise ValueError(f"Unknown provider: {name}")
        
        # Override default if specific URL is known for this named provider
        if not base_url:
            base_url = cls._DEFAULT_URLS.get(name.lower())
            
        return provider_cls(api_key, base_url=base_url)


PROVIDER_ENV_VARS: Dict[str, str] = {
    "openai": "OPENAI_API_KEY",
    "nvidia": "NVIDIA_API_KEY",
    "fireworks": "FIREWORKS_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "google": "GEMINI_API_KEY",
    "xai": "XAI_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "alibaba": "ALIBABA_API_KEY",
    "moonshot": "MOONSHOT_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
}

# gemini is an alias for google — handled via ProviderFactory._PROVIDERS
# but intentionally excluded here to avoid cache-file mismatch (results_google.json)

OPENAI_COMPATIBLE_PROVIDERS: Set[str] = {
    "openai", "nvidia", "fireworks", "xai",
    "deepseek", "alibaba", "moonshot", "openrouter",
}

def main():
    parser = argparse.ArgumentParser(description="Fetch models from various providers.")
    parser.add_argument("--provider", required=True, help="Provider name (e.g., openai, nvidia, fireworks, anthropic, google)")
    parser.add_argument("--api-key", help="API key (defaults to env var based on provider name)")
    parser.add_argument("--output", help="Output file path")
    
    args = parser.parse_args()
    
    env_var = PROVIDER_ENV_VARS.get(args.provider.lower())
    api_key = args.api_key or (os.getenv(env_var) if env_var else None)
    
    if not api_key:
        print(f"Error: No API key found for {args.provider}. Set {env_var} or use --api-key.")
        sys.exit(1)
        
    try:
        provider = ProviderFactory.get_provider(args.provider, api_key)
        models = provider.fetch_models()
        
        result = {
            "provider": args.provider,
            "count": len(models),
            "models": models
        }
        
        if args.output:
            with open(args.output, "w") as f:
                json.dump(result, f, indent=2)
            print(f"Results saved to {args.output}")
        else:
            print(json.dumps(result, indent=2))
            
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
