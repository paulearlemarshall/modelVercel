#!/usr/bin/env python3
"""Terminal UI for fetching, exploring, and testing provider models."""

from __future__ import annotations

import argparse
import getpass
import json
import os
import shutil
import sys
import textwrap
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

from model_fetcher import OPENAI_COMPATIBLE_PROVIDERS, PROVIDER_ENV_VARS, ProviderFactory


def safe_model_id(model: Dict[str, Any]) -> str:
    for key in ("id", "name", "model", "model_id"):
        value = model.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return "<unknown-model-id>"


def _is_serverless(model: Dict[str, Any]) -> bool:
    return bool(model.get("supportsServerless", False))


def flatten_json(value: Any, prefix: str = "") -> List[Tuple[str, str]]:
    rows: List[Tuple[str, str]] = []
    if isinstance(value, dict):
        for k in sorted(value.keys(), key=str):
            child_prefix = f"{prefix}.{k}" if prefix else str(k)
            rows.extend(flatten_json(value[k], child_prefix))
    elif isinstance(value, list):
        if not value:
            rows.append((prefix, "[]"))
        for i, item in enumerate(value):
            child_prefix = f"{prefix}[{i}]" if prefix else f"[{i}]"
            rows.extend(flatten_json(item, child_prefix))
    else:
        rows.append((prefix or "$", json.dumps(value, ensure_ascii=False)))
    return rows


def provider_results_path(provider: str) -> str:
    return os.path.join(os.path.dirname(__file__), f"results_{provider}.json")


def load_dotenv_file(dotenv_path: str) -> None:
    if not os.path.exists(dotenv_path):
        return
    try:
        with open(dotenv_path, "r", encoding="utf-8") as f:
            for raw_line in f:
                line = raw_line.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("export "):
                    line = line[7:].strip()
                if "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
    except OSError:
        return


def post_json(url: str, headers: Dict[str, str], payload: Dict[str, Any], timeout: int = 45) -> Dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as response:
        raw = response.read().decode("utf-8", errors="replace")
    parsed = json.loads(raw)
    return parsed if isinstance(parsed, dict) else {"raw": parsed}


def extract_openai_text(payload: Dict[str, Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return json.dumps(payload, ensure_ascii=False)
    first = choices[0]
    if not isinstance(first, dict):
        return json.dumps(first, ensure_ascii=False)
    message = first.get("message")
    if isinstance(message, dict):
        content = message.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            text_parts: List[str] = []
            for part in content:
                if isinstance(part, dict) and isinstance(part.get("text"), str):
                    text_parts.append(part["text"])
            if text_parts:
                return "\n".join(text_parts)
    if isinstance(first.get("text"), str):
        return str(first["text"])
    return json.dumps(first, ensure_ascii=False)


def extract_anthropic_text(payload: Dict[str, Any]) -> str:
    content = payload.get("content")
    if isinstance(content, list):
        text_parts: List[str] = []
        for part in content:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                text_parts.append(part["text"])
        if text_parts:
            return "\n".join(text_parts)
    return json.dumps(payload, ensure_ascii=False)


def extract_google_text(payload: Dict[str, Any]) -> str:
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return json.dumps(payload, ensure_ascii=False)
    first = candidates[0]
    if not isinstance(first, dict):
        return json.dumps(first, ensure_ascii=False)
    content = first.get("content")
    if not isinstance(content, dict):
        return json.dumps(first, ensure_ascii=False)
    parts = content.get("parts")
    if not isinstance(parts, list):
        return json.dumps(content, ensure_ascii=False)
    text_parts: List[str] = []
    for part in parts:
        if isinstance(part, dict) and isinstance(part.get("text"), str):
            text_parts.append(part["text"])
    return "\n".join(text_parts) if text_parts else json.dumps(parts, ensure_ascii=False)


@dataclass
class AppState:
    provider_names: List[str]
    provider_filter: str = "all"
    api_key_overrides: Dict[str, str] = field(default_factory=dict)
    provider_models: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)
    provider_details: Dict[str, Dict[str, Dict[str, Any]]] = field(default_factory=dict)
    visible_items: List[Tuple[str, Dict[str, Any]]] = field(default_factory=list)
    selected_index: int = 0
    model_scroll: int = 0
    param_scroll: int = 0
    search_text: str = ""
    status: str = "Press f to load cache or F to refresh API"
    show_details_if_available: bool = True
    refreshed_providers: Set[str] = field(default_factory=set)
    prompt_text: str = "Say hello and report your provider/model id."
    response_text: str = ""
    last_rtt_ms: Optional[float] = None
    right_panel_mode: str = "params"
    chat_visible: bool = False
    chat_messages: List[Dict[str, str]] = field(default_factory=list)
    chat_input: str = ""
    chat_editing: bool = False
    chat_scroll: int = 0
    diag_cache: str = "cache: not checked"
    diag_refresh: str = "refresh: not run"
    diag_persist: str = "persist: not run"
    logs: List[str] = field(default_factory=list)
    serverless_only: bool = False

    def current_item(self) -> Optional[Tuple[str, Dict[str, Any]]]:
        if not self.visible_items:
            return None
        bounded = max(0, min(self.selected_index, len(self.visible_items) - 1))
        self.selected_index = bounded
        return self.visible_items[bounded]

    def current_parameter_rows(self) -> List[Tuple[str, str]]:
        current = self.current_item()
        if not current:
            return []
        provider, model = current
        model_id = safe_model_id(model)
        if self.show_details_if_available:
            detail_map = self.provider_details.get(provider, {})
            if model_id in detail_map:
                return flatten_json(detail_map[model_id])
        return flatten_json(model)

    def apply_filter(self) -> None:
        previous_provider: Optional[str] = None
        previous_model_id: Optional[str] = None
        current = self.current_item()
        if current:
            previous_provider, previous_model = current
            previous_model_id = safe_model_id(previous_model)

        text = self.search_text.lower().strip()
        providers = self.provider_names if self.provider_filter == "all" else [self.provider_filter]
        items: List[Tuple[str, Dict[str, Any]]] = []
        for provider in providers:
            for model in self.provider_models.get(provider, []):
                if text:
                    model_id = safe_model_id(model).lower()
                    blob = json.dumps(model, ensure_ascii=False).lower()
                    if text in provider.lower() and text not in model_id and text not in blob:
                        continue
                    if text not in provider.lower() and text not in model_id and text not in blob:
                        continue
                if self.serverless_only and not _is_serverless(model):
                    continue
                items.append((provider, model))
        items.sort(key=lambda item: (item[0], safe_model_id(item[1]).lower()))
        self.visible_items = items

        restored_index = 0
        if previous_provider and previous_model_id:
            for i, (provider, model) in enumerate(self.visible_items):
                if provider == previous_provider and safe_model_id(model) == previous_model_id:
                    restored_index = i
                    break

        self.selected_index = restored_index
        self.model_scroll = 0
        self.param_scroll = 0


def add_log(state: AppState, message: str) -> None:
    stamp = time.strftime("%H:%M:%S")
    state.logs.append(f"{stamp} {message}")
    if len(state.logs) > 500:
        state.logs = state.logs[-500:]


def read_api_key(state: AppState, provider: str) -> Optional[str]:
    if provider in state.api_key_overrides and state.api_key_overrides[provider].strip():
        return state.api_key_overrides[provider]
    env_var = PROVIDER_ENV_VARS.get(provider)
    return os.getenv(env_var) if env_var else None


def save_provider_file(state: AppState, provider: str) -> None:
    path = provider_results_path(provider)
    payload: Dict[str, Any] = {
        "provider": provider,
        "model_count": len(state.provider_models.get(provider, [])),
        "models": state.provider_models.get(provider, []),
    }
    details = state.provider_details.get(provider)
    if details:
        payload["details"] = details
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    state.diag_persist = f"persist: ok {os.path.basename(path)} ({len(payload['models'])} models)"
    add_log(state, f"Saved {provider} cache -> {os.path.basename(path)}")


def load_provider_file(state: AppState, provider: str) -> bool:
    path = provider_results_path(provider)
    if not os.path.exists(path):
        add_log(state, f"Cache missing for {provider} ({os.path.basename(path)})")
        return False
    try:
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception:
        add_log(state, f"Cache read failed for {provider} ({os.path.basename(path)})")
        return False

    models = payload.get("models")
    details = payload.get("details")
    if not isinstance(models, list):
        add_log(state, f"Cache malformed for {provider} ({os.path.basename(path)})")
        return False
    state.provider_models[provider] = [m for m in models if isinstance(m, dict)]
    if isinstance(details, dict):
        state.provider_details[provider] = details
    else:
        state.provider_details.setdefault(provider, {})
    add_log(state, f"Cache loaded for {provider}: {len(state.provider_models[provider])} models")
    return True


def load_all_provider_files(state: AppState) -> int:
    loaded = 0
    failed: List[str] = []
    for provider in state.provider_names:
        if load_provider_file(state, provider):
            loaded += 1
        else:
            failed.append(provider)
    state.apply_filter()
    state.status = f"Loaded cache for {loaded}/{len(state.provider_names)} providers"
    if failed:
        state.diag_cache = f"cache: partial ({loaded}/{len(state.provider_names)}) missing/invalid={','.join(failed)}"
    else:
        state.diag_cache = f"cache: ok ({loaded}/{len(state.provider_names)})"
    add_log(state, state.status)
    return loaded


def refresh_provider_from_api(state: AppState, provider: str, persist_now: bool = True) -> None:
    api_key = read_api_key(state, provider)
    if not api_key:
        env_var = PROVIDER_ENV_VARS.get(provider, "<unknown>")
        state.status = f"Missing API key for {provider}. Set {env_var} in .env"
        state.diag_refresh = f"refresh: failed {provider} (missing key)"
        add_log(state, state.status)
        return

    try:
        add_log(state, f"Refreshing {provider} from API...")
        adapter = ProviderFactory.get_provider(provider, api_key)
        models = adapter.fetch_models()
        state.provider_models[provider] = [m for m in models if isinstance(m, dict)]
        state.provider_details.setdefault(provider, {})
        state.refreshed_providers.add(provider)
        if persist_now:
            save_provider_file(state, provider)
        state.apply_filter()
        state.status = f"Refreshed {len(state.provider_models[provider])} models for {provider}"
        state.diag_refresh = f"refresh: ok {provider} ({len(state.provider_models[provider])} models)"
        add_log(state, state.status)
    except Exception as exc:  # noqa: BLE001
        state.status = f"Refresh failed for {provider}: {exc}"
        state.diag_refresh = f"refresh: failed {provider}"
        add_log(state, state.status)


def fetch_selected_details(state: AppState) -> None:
    current = state.current_item()
    if not current:
        state.status = "No model selected"
        add_log(state, state.status)
        return
    provider, model = current
    api_key = read_api_key(state, provider)
    if not api_key:
        state.status = f"Missing API key for {provider}"
        add_log(state, state.status)
        return

    model_id = safe_model_id(model)
    try:
        adapter = ProviderFactory.get_provider(provider, api_key)
        details = adapter.fetch_model_details(model_id)
        state.provider_details.setdefault(provider, {})[model_id] = details
        state.show_details_if_available = True
        state.param_scroll = 0
        state.status = f"Loaded details for {provider}:{model_id}"
        add_log(state, state.status)
    except Exception as exc:  # noqa: BLE001
        state.status = f"Detail fetch failed: {exc}"
        add_log(state, state.status)


def fetch_all_visible_details(state: AppState) -> None:
    if not state.visible_items:
        state.status = "No visible models to fetch details for"
        add_log(state, state.status)
        return

    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for provider, model in state.visible_items:
        grouped.setdefault(provider, []).append(model)

    loaded = 0
    total = len(state.visible_items)
    for provider, models in grouped.items():
        api_key = read_api_key(state, provider)
        if not api_key:
            continue
        try:
            adapter = ProviderFactory.get_provider(provider, api_key)
            for model in models:
                model_id = safe_model_id(model)
                try:
                    details = adapter.fetch_model_details(model_id)
                    state.provider_details.setdefault(provider, {})[model_id] = details
                    loaded += 1
                except Exception:
                    continue
        except Exception:
            continue

    state.show_details_if_available = True
    state.param_scroll = 0
    state.status = f"Loaded detail payloads for {loaded}/{total} visible models"
    add_log(state, state.status)


def chat_send(state: AppState) -> None:
    current = state.current_item()
    if not current:
        state.status = "No model selected for chat"
        add_log(state, state.status)
        return
    provider, model = current
    model_id = safe_model_id(model)
    if not state.chat_input.strip():
        state.status = "Chat message is empty"
        add_log(state, state.status)
        return
    api_key = read_api_key(state, provider)
    if not api_key:
        state.status = f"Missing API key for {provider}"
        add_log(state, state.status)
        return

    user_msg = state.chat_input.strip()
    state.chat_input = ""
    state.chat_editing = False
    state.chat_messages.append(
        {"role": "user", "content": user_msg, "provider": provider, "model": model_id}
    )

    try:
        add_log(state, f"Chat: {provider}:{model_id}...")
        adapter = ProviderFactory.get_provider(provider, api_key)
        start = time.perf_counter()
        messages_for_api = [
            {"role": str(msg.get("role", "user")), "content": str(msg.get("content", ""))}
            for msg in state.chat_messages
        ]

        if provider in OPENAI_COMPATIBLE_PROVIDERS:
            url = f"{adapter.base_url}/chat/completions"
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
            payload = {
                "model": model_id,
                "messages": messages_for_api,
                "max_tokens": 800,
                "temperature": 0.7,
            }
            data = post_json(url, headers, payload, timeout=90)
            response_text = extract_openai_text(data)
        elif provider == "anthropic":
            url = f"{adapter.base_url}/messages"
            headers = {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
            payload = {
                "model": model_id,
                "max_tokens": 800,
                "messages": messages_for_api,
            }
            data = post_json(url, headers, payload, timeout=90)
            response_text = extract_anthropic_text(data)
        elif provider == "google":
            path = model_id if model_id.startswith("models/") else f"models/{model_id}"
            encoded_path = urllib.parse.quote(path, safe="models/")
            url = f"{adapter.base_url}/{encoded_path}:generateContent?key={api_key}"
            headers = {
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
            contents = []
            for msg in messages_for_api:
                role = "user" if msg["role"] == "user" else "model"
                contents.append({"role": role, "parts": [{"text": msg["content"]}]})
            payload = {"contents": contents}
            data = post_json(url, headers, payload, timeout=90)
            response_text = extract_google_text(data)
        else:
            state.chat_messages.append(
                {
                    "role": "assistant",
                    "content": f"Chat not implemented for {provider}",
                    "provider": provider,
                    "model": model_id,
                }
            )
            state.status = f"Chat not implemented for {provider}"
            add_log(state, state.status)
            state.chat_editing = True
            return

        elapsed_ms = (time.perf_counter() - start) * 1000.0
        state.chat_messages.append(
            {
                "role": "assistant",
                "content": response_text,
                "provider": provider,
                "model": model_id,
            }
        )
        state.chat_scroll = len(state.chat_messages)
        state.status = f"Chat response ({elapsed_ms:.0f}ms)"
        add_log(state, state.status)
    except Exception as exc:
        state.chat_messages.append(
            {
                "role": "assistant",
                "content": f"Error: {exc}",
                "provider": provider,
                "model": model_id,
            }
        )
        state.status = f"Chat failed: {exc}"
        add_log(state, state.status)
    finally:
        state.chat_editing = True


def run_prompt_test(state: AppState) -> None:
    current = state.current_item()
    if not current:
        state.status = "No model selected"
        add_log(state, state.status)
        return
    provider, model = current
    model_id = safe_model_id(model)
    prompt = state.prompt_text.strip()
    if not prompt:
        state.status = "Prompt is empty"
        add_log(state, state.status)
        return

    api_key = read_api_key(state, provider)
    if not api_key:
        state.status = f"Missing API key for {provider}"
        add_log(state, state.status)
        return

    try:
        add_log(state, f"Prompt test start: {provider}:{model_id}")
        adapter = ProviderFactory.get_provider(provider, api_key)
        start = time.perf_counter()

        if provider in OPENAI_COMPATIBLE_PROVIDERS:
            url = f"{adapter.base_url}/chat/completions"
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
            payload = {
                "model": model_id,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 300,
                "temperature": 0.2,
            }
            data = post_json(url, headers, payload, timeout=60)
            response_text = extract_openai_text(data)

        elif provider == "anthropic":
            url = f"{adapter.base_url}/messages"
            headers = {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
            payload = {
                "model": model_id,
                "max_tokens": 300,
                "messages": [{"role": "user", "content": prompt}],
            }
            data = post_json(url, headers, payload, timeout=60)
            response_text = extract_anthropic_text(data)

        elif provider == "google":
            path = model_id if model_id.startswith("models/") else f"models/{model_id}"
            encoded_path = urllib.parse.quote(path, safe="models/")
            url = f"{adapter.base_url}/{encoded_path}:generateContent?key={api_key}"
            headers = {
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
            payload = {
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            }
            data = post_json(url, headers, payload, timeout=60)
            response_text = extract_google_text(data)

        else:
            state.status = f"Prompt test not implemented for provider {provider}"
            add_log(state, state.status)
            return

        elapsed_ms = (time.perf_counter() - start) * 1000.0
        state.last_rtt_ms = elapsed_ms
        state.response_text = response_text
        state.right_panel_mode = "response"
        state.status = f"Prompt test complete for {provider}:{model_id} ({elapsed_ms:.1f} ms)"
        add_log(state, state.status)
    except Exception as exc:  # noqa: BLE001
        state.status = f"Prompt test failed: {exc}"
        add_log(state, state.status)


def clear_screen() -> None:
    os.system("cls" if os.name == "nt" else "clear")


def prompt_input(label: str, default: str = "", secret: bool = False) -> str:
    if secret:
        return getpass.getpass(f"{label}: ").strip()
    if default:
        typed = input(f"{label} [{default}]: ").strip()
        return typed if typed else default
    return input(f"{label}: ").strip()


def read_key() -> str:
    if os.name == "nt":
        import msvcrt

        first = msvcrt.getwch()
        if first in ("\x00", "\xe0"):
            second = msvcrt.getwch()
            mapping = {
                "H": "UP",
                "P": "DOWN",
                "K": "LEFT",
                "M": "RIGHT",
                "I": "PGUP",
                "Q": "PGDN",
            }
            return mapping.get(second, "")
        if first == "\r":
            return "ENTER"
        if first == "\x1b":
            return "ESC"
        if first == "\x08":
            return "BACKSPACE"
        if first == "\x7f":
            return "DEL"
        return first

    import termios
    import tty

    fd = sys.stdin.fileno()
    old_settings = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        ch = sys.stdin.read(1)
        if ch == "\x1b":
            seq = sys.stdin.read(2)
            mapping = {
                "[A": "UP",
                "[B": "DOWN",
                "[C": "RIGHT",
                "[D": "LEFT",
            }
            return mapping.get(seq, "ESC")
        if ch in ("\r", "\n"):
            return "ENTER"
        return ch
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)


def wrapped_lines(text: str, width: int) -> List[str]:
    out: List[str] = []
    for raw in text.splitlines() or [""]:
        parts = textwrap.wrap(raw, width=max(8, width), replace_whitespace=False)
        if parts:
            out.extend(parts)
        else:
            out.append("")
    return out


def format_menu_row(items: List[str], width: int) -> str:
    text = " | ".join(items)
    if len(text) >= width:
        return text[:width]
    return text.ljust(width)


def render_lines(state: AppState) -> List[str]:
    term_size = shutil.get_terminal_size((120, 34))
    width = max(90, term_size.columns)
    height = max(22, term_size.lines)
    split = max(36, int(width * 0.38))
    left_w = split - 1
    right_w = width - split - 2
    usable_rows = max(6, height - 13)

    if state.selected_index < state.model_scroll:
        state.model_scroll = state.selected_index
    if state.selected_index >= state.model_scroll + usable_rows:
        state.model_scroll = state.selected_index - usable_rows + 1

    if state.chat_visible:
        current = state.current_item()
        if current:
            response_header = f"Chat | {current[0]}:{safe_model_id(current[1])}"
        else:
            response_header = "Chat"
        body_rows = []
        for msg in state.chat_messages:
            msg_provider = str(msg.get("provider", "unknown"))
            msg_model = str(msg.get("model", "unknown-model"))
            role_label = "you" if msg.get("role") == "user" else "assistant"
            body_rows.append(("", f"[{role_label} | {msg_provider}:{msg_model}]"))
            for line in wrapped_lines(msg["content"], right_w - 4):
                body_rows.append(("", line))
            body_rows.append(("", ""))
        if not state.chat_messages:
            body_rows.append(("", "<type message, Enter to send, Esc to close>"))
        max_chat_scroll = max(0, len(body_rows) - usable_rows)
        if state.chat_scroll > max_chat_scroll:
            state.chat_scroll = max_chat_scroll
        body_rows = body_rows[state.chat_scroll :]
    elif state.right_panel_mode == "response":
        current = state.current_item()
        active = f"{current[0]}:{safe_model_id(current[1])}" if current else "<none>"
        timing = f"{state.last_rtt_ms:.1f} ms" if state.last_rtt_ms is not None else "n/a"
        response_header = f"Response | selected={active} | roundtrip={timing}"
        body_rows = [("", line) for line in wrapped_lines(state.response_text or "<no response yet>", right_w - 2)]
    elif state.right_panel_mode == "logs":
        response_header = f"Logs ({len(state.logs)})"
        if state.logs:
            body_rows = []
            for line in state.logs:
                for wrapped in wrapped_lines(line, right_w - 2):
                    body_rows.append(("", wrapped))
        else:
            body_rows = [("", "<no log entries yet>")]
    else:
        response_header = "Parameters"
        body_rows = state.current_parameter_rows()
        max_param_scroll = max(0, len(body_rows) - usable_rows)
        if state.param_scroll > max_param_scroll:
            state.param_scroll = max_param_scroll

    left_count = len(state.visible_items)
    model_count_total = sum(len(state.provider_models.get(p, [])) for p in state.provider_names)
    header = f"Scope: {state.provider_filter} | Visible: {left_count} | Total loaded: {model_count_total}"
    diag_line = f"Diag: {state.diag_cache} | {state.diag_refresh} | {state.diag_persist}"
    log_line = f"Log: {(state.logs[-1] if state.logs else 'no log entries yet')}"
    prompt_preview = state.prompt_text.replace("\n", " ")
    if len(prompt_preview) > width - 10:
        prompt_preview = prompt_preview[: width - 13] + "..."

    lines = [
        header[:width],
        state.status[:width],
        diag_line[:width],
        log_line[:width],
        ("Search: " + (state.search_text or "<none>") + " | Prompt: " + prompt_preview)[:width],
        "-" * min(width, 140),
        f"{'Models'.ljust(left_w)}| {response_header}",
        "-" * min(width, 140),
    ]

    for row in range(usable_rows):
        idx = state.model_scroll + row
        left_text = ""
        right_text = ""

        if idx < len(state.visible_items):
            provider, model = state.visible_items[idx]
            model_id = safe_model_id(model)
            selected_marker = ">" if idx == state.selected_index else " "
            details_marker = "*" if model_id in state.provider_details.get(provider, {}) else " "
            serverless_marker = "~" if _is_serverless(model) else " "
            left_text = f"{selected_marker}{details_marker}{serverless_marker} {idx + 1:>3}. [{provider}] {model_id}"

        body_idx = state.param_scroll + row
        if body_idx < len(body_rows):
            key, val = body_rows[body_idx]
            right_text = f"{key}: {val}" if key else val

        lines.append(f"{left_text[:left_w].ljust(left_w)}| {right_text[:right_w]}")

    lines.append("-" * min(width, 140))
    lines.append(
        format_menu_row(
            [
                "f load cache(all)",
                "F refresh scope",
                "v cycle provider | n serverless",
            ],
            width,
        )
    )
    lines.append(
        format_menu_row(
            [
                "Up/Down move model",
                "h/m scroll right",
                "l details(sel)",
                "a details(all)",
            ],
            width,
        )
    )
    lines.append(
        format_menu_row(
            [
                "u edit prompt",
                "r run prompt test",
                "c chat toggle",
                "K provider key",
                "q quit",
            ],
            width,
        )
    )
    if state.chat_visible:
        lines.append(format_menu_row(["Chat mode", "Type to compose", "Up/Down model | Enter send | Esc close"], width))
        chat_input_display = state.chat_input or "<empty>"
        if len(chat_input_display) > right_w - 10:
            chat_input_display = chat_input_display[: right_w - 13] + "..."
        lines.append(f"Chat: {chat_input_display} | Enter=send | Esc=close | Up/Down=model")
    lines.append(format_menu_row(["Legend: > selected", "* details", "~ serverless"], width))
    return lines


def cycle_provider_filter(state: AppState) -> None:
    options = ["all", *state.provider_names]
    idx = options.index(state.provider_filter)
    state.provider_filter = options[(idx + 1) % len(options)]
    state.apply_filter()
    state.status = f"Filter switched to {state.provider_filter}"
    add_log(state, state.status)


def refresh_scope_from_filter(state: AppState, persist_now: bool = True) -> None:
    if state.provider_filter == "all":
        ok = 0
        for provider in state.provider_names:
            before = state.diag_refresh
            refresh_provider_from_api(state, provider, persist_now=persist_now)
            if state.diag_refresh != before and state.diag_refresh.startswith("refresh: ok"):
                ok += 1
        state.status = f"Refresh scope=all complete ({ok}/{len(state.provider_names)} providers ok)"
        add_log(state, state.status)
        return

    refresh_provider_from_api(state, state.provider_filter, persist_now=persist_now)


def key_override_target_provider(state: AppState) -> Optional[str]:
    if state.provider_filter != "all":
        return state.provider_filter
    current = state.current_item()
    if current:
        return current[0]
    return None


def run_tui(state: AppState, auto_fetch: bool) -> None:
    add_log(state, "TUI started")
    loaded = load_all_provider_files(state)
    if auto_fetch and loaded == 0:
        add_log(state, "No cache found; auto-refreshing current scope")
        refresh_scope_from_filter(state, persist_now=True)

    while True:
        clear_screen()
        for line in render_lines(state):
            print(line)

        key = read_key()
        if not key:
            continue

        if state.chat_visible:
            if key == "ESC":
                state.chat_visible = False
                state.chat_input = ""
                state.chat_scroll = 0
                state.status = "Chat closed"
                add_log(state, state.status)
                continue
            if key == "ENTER":
                if state.chat_input.strip():
                    chat_send(state)
                continue
            if key == "UP":
                if state.selected_index > 0:
                    state.selected_index -= 1
                    state.model_scroll = max(0, state.selected_index - 5)
                continue
            if key == "DOWN":
                if state.selected_index < max(0, len(state.visible_items) - 1):
                    state.selected_index += 1
                    state.model_scroll = max(0, state.selected_index - 5)
                continue
            if key == "BACKSPACE":
                state.chat_input = state.chat_input[:-1]
                continue
            if key == "DEL":
                state.chat_input = ""
                continue
            if len(key) == 1:
                state.chat_input += key
                continue
            continue

        if key in ("q", "Q"):
            break

        if key in ("c", "C"):
            state.chat_visible = True
            state.right_panel_mode = "params"
            state.status = "Chat opened"
            add_log(state, state.status)
            continue
        if key == "UP":
            if state.selected_index > 0:
                state.selected_index -= 1
                state.model_scroll = max(0, state.selected_index - 5)
                state.param_scroll = 0
            continue
        if key == "DOWN":
            if state.selected_index < max(0, len(state.visible_items) - 1):
                state.selected_index += 1
                state.model_scroll = max(0, state.selected_index - 5)
                state.param_scroll = 0
            continue
        if key in ("LEFT", "h", "PGUP"):
            step = 10 if key == "PGUP" else 1
            state.param_scroll = max(0, state.param_scroll - step)
            continue
        if key in ("RIGHT", "m", "PGDN"):
            step = 10 if key == "PGDN" else 1
            state.param_scroll += step
            continue
        if key in ("n", "N"):
            state.serverless_only = not state.serverless_only
            state.apply_filter()
            state.status = f"Serverless filter: {'ON' if state.serverless_only else 'OFF'} ({len(state.visible_items)} visible)"
            add_log(state, state.status)
            continue
        if key in ("s", "S"):
            clear_screen()
            state.search_text = prompt_input("Search models", default=state.search_text)
            state.apply_filter()
            state.status = f"Filter applied ({len(state.visible_items)} matches)"
            add_log(state, state.status)
            continue
        if key == "K":
            clear_screen()
            target_provider = key_override_target_provider(state)
            if not target_provider:
                state.status = "Choose a provider scope or select a row before setting key override"
                add_log(state, state.status)
                continue
            value = prompt_input(f"API key override for {target_provider}", secret=True)
            if value:
                state.api_key_overrides[target_provider] = value
                state.status = f"API key override updated for {target_provider}"
            else:
                state.status = "API key override unchanged"
            add_log(state, state.status)
            continue
        if key in ("l", "L"):
            fetch_selected_details(state)
            continue
        if key in ("a", "A"):
            fetch_all_visible_details(state)
            continue
        if key in ("u", "U"):
            clear_screen()
            state.prompt_text = prompt_input("Prompt", default=state.prompt_text)
            state.status = "Prompt updated"
            add_log(state, state.status)
            continue
        if key in ("r", "R"):
            run_prompt_test(state)
            continue
        if key in ("g", "G"):
            if state.right_panel_mode == "logs":
                state.right_panel_mode = "params"
                state.param_scroll = 0
                state.status = "Right panel: params"
            else:
                state.right_panel_mode = "logs"
                state.param_scroll = 10**9
                state.status = "Right panel: logs"
            add_log(state, state.status)
            continue
        if key in ("t", "T"):
            if state.right_panel_mode == "logs":
                state.right_panel_mode = "params"
            else:
                state.right_panel_mode = "response" if state.right_panel_mode == "params" else "params"
            state.param_scroll = 0
            state.status = f"Right panel: {state.right_panel_mode}"
            add_log(state, state.status)
            continue
        if key == "v" or key == "V":
            cycle_provider_filter(state)
            continue
        if key == "F":
            refresh_scope_from_filter(state, persist_now=True)
            continue
        if key == "f":
            load_all_provider_files(state)
            continue

    for provider in sorted(state.refreshed_providers):
        save_provider_file(state, provider)
        state.status = f"Persisted refreshed providers: {', '.join(sorted(state.refreshed_providers))}"
        add_log(state, state.status)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Interactive TUI for retrieving, exploring, and testing provider models."
    )
    parser.add_argument(
        "--provider",
        choices=["all", *sorted(PROVIDER_ENV_VARS.keys())],
        default="all",
        help="Startup scope for filter/refresh (all or one provider).",
    )
    parser.add_argument(
        "--api-key",
        help="Optional API key override for startup provider scope (ignored when --provider=all).",
    )
    parser.add_argument(
        "--no-auto-fetch",
        action="store_true",
        help="Start without automatic API refresh when no cache exists.",
    )
    return parser.parse_args()


def main() -> int:
    load_dotenv_file(os.path.join(os.path.dirname(__file__), ".env"))
    args = parse_args()
    providers = sorted(PROVIDER_ENV_VARS.keys())
    state = AppState(provider_names=providers, provider_filter=args.provider)
    if args.api_key and args.provider != "all":
        state.api_key_overrides[args.provider] = args.api_key

    try:
        run_tui(state, not args.no_auto_fetch)
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
