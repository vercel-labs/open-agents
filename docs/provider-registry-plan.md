# Provider Registry Plan

## Problem Statement

We want client-driven model selection without sending non-serializable
LanguageModel objects across the client/server boundary. Today, each app
hardcodes model configuration locally, which makes it harder to share model
policies, allowlists, and aliasing across the monorepo.

## Context

- The web client can only send strings, so the server must resolve the model.
- The AI SDK supports provider registries and custom providers that can map
  string IDs to LanguageModel instances with pre-configured settings.
- Cache-control behavior depends on model/provider detection; passing a prefixed
  model ID string (e.g., "anthropic:claude-haiku-4.5") or a resolved model
  object preserves correct provider-specific behavior.
- We want to share the same registry configuration and helpers across CLI, TUI,
  and web while keeping server-only initialization on the server.

## Suggested Solution

1. Create a shared provider registry package (e.g., `packages/providers/`).
   - Export a registry instance (or factory) that registers supported providers.
   - Export an allowlist of supported model IDs for validation.
   - Export model label defaults for UI display.

2. Add a helper to format/normalize model IDs.
   - Example: `formatModelId({ provider: "anthropic", model: "haiku" })`
     -> `"anthropic:haiku"`.
   - This keeps client payloads as simple strings while standardizing IDs.

3. Use string model IDs on the client, resolve on the server.
   - Client sends `modelId` as a string (prefixed).
   - Server validates against allowlist and resolves:
     `registry.languageModel(modelId)` (or uses the string with a global provider).

4. Keep LanguageModel objects server-only.
   - Any registry setup that uses env vars or provider SDKs stays in server code.
   - Client uses only strings and labels.

5. Update apps to use the shared registry package.
   - Web API routes resolve the model from the registry per request.
   - CLI/TUI can still select via model ID string and display labels from the
     shared package, while passing the resolved model to the agent.
