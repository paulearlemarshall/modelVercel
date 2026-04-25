# Multi-Provider Model Fetcher

A modular Python utility designed to fetch, normalize, and aggregate model lists and details from various AI providers.

## Project Overview
This project provides a robust, extensible framework for interacting with multiple AI Model Context Protocol (MCP) and REST APIs to retrieve available models. It handles the specific authentication and response formats of different providers, presenting a unified interface for model discovery.

## Key Features
- **Modular Architecture**: Built on a class-based system (`ModelProvider`) with a `ProviderFactory` for easy integration of new APIs.
- **Unified Interface**: Fetches models from diverse sources and returns them in a consistent JSON format.
- **Security**: Uses environment variable management via `.env` files to protect sensitive API keys.
- **Robust Error Handling**: Includes retry logic for transient network errors and detailed reporting for HTTP failures.

## Supported Providers
- **Nvidia API Catalog**: Fetches the latest models available via Nvidia's integration platform.
- **OpenAI**: Standard support for the OpenAI models API.
- **Fireworks.ai**: Specialized support for Fireworks' high-performance inference models.
- **Anthropic**: Direct integration with the Anthropic models endpoint.
- **Google Gemini**: Support for Google's Gemini family via Google AI Studio.
- **xAI**: Support for Grok models via the xAI API.

## Project Structure
- `model_fetcher.py`: The core modular engine and provider implementations.
- `nvidia_models.py`: CLI wrapper for fetching and saving model data.
- `.env`: Local configuration for API credentials.
- `models.json`: Cached model data (example output).

## Usage
Fetch models from a specific provider:
```bash
python model_fetcher.py --provider anthropic --output anthropic_models.json
```
