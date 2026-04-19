import {
  createGateway,
  defaultSettingsMiddleware,
  gateway as aiGateway,
  wrapLanguageModel,
  type GatewayModelId,
  type JSONValue,
  type LanguageModel,
} from "ai";
import { devToolsMiddleware } from "@ai-sdk/devtools";
import type { AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";

type WrapModelInput = Parameters<typeof wrapLanguageModel>[0]["model"];

const PROVIDER_ENV_KEYS: Record<string, string> = {
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

/**
 * Create a model directly from a provider SDK, bypassing the AI Gateway.
 * Returns null when the modelId targets a provider we don't recognize at
 * all (e.g. `fireworks/…`) so the caller can decide whether to fall back.
 * Throws when the provider IS recognized but its API key is missing —
 * silently falling back to the AI Gateway at that point has led to
 * confusing credit-card errors.
 */
async function createModelDirect(
  modelId: string,
): Promise<LanguageModel | null> {
  const [provider, ...rest] = modelId.split("/");
  const modelName = rest.join("/");
  if (!provider) return null;
  const envKey = PROVIDER_ENV_KEYS[provider];
  if (!envKey) {
    return null;
  }
  if (!process.env[envKey]) {
    throw new Error(
      `Model "${modelId}" requires ${envKey} to be set, but it is missing on this runtime. ` +
        `Set the env var on the worker (Render → Environment) and redeploy, or pick a different provider.`,
    );
  }

  if (provider === "google") {
    const { google } = await import("@ai-sdk/google");
    return google(modelName);
  }
  if (provider === "anthropic") {
    const { anthropic } = await import("@ai-sdk/anthropic");
    return anthropic(modelName);
  }
  if (provider === "openai") {
    const { openai } = await import("@ai-sdk/openai");
    return openai(modelName);
  }
  return null;
}

// Claude 4.5+ rejects `thinking.type.enabled` and requires
// `thinking.type.adaptive` + `output_config.effort`. Older models
// (<= 4.1, 3.x) still use the legacy extended-thinking API with a
// budget. We also accept the hyphenated slug form (claude-opus-4-7)
// since that's what Anthropic's API actually expects.
function getAnthropicSettings(modelId: string): AnthropicLanguageModelOptions {
  if (isClaude45OrNewer(modelId)) {
    return {
      effort: "medium",
      thinking: { type: "adaptive" },
    } satisfies AnthropicLanguageModelOptions;
  }

  return {
    thinking: { type: "enabled", budgetTokens: 8000 },
  };
}

/** True for any claude-*-4.5 / 4-5 / 4.6 / 4-6 / 4.7 / 4-7 (and newer). */
function isClaude45OrNewer(modelId: string): boolean {
  // Match numeric version in either dotted (4.6) or hyphenated (4-6) form
  const m = modelId.match(/(?:^|[^0-9])(\d+)[.\-](\d+)(?:[^0-9]|$)/);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  if (major > 4) return true;
  if (major === 4 && minor >= 5) return true;
  return false;
}

function isJsonObject(value: unknown): value is Record<string, JSONValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toProviderOptionsRecord(
  options: Record<string, unknown>,
): Record<string, JSONValue> {
  return options as Record<string, JSONValue>;
}

function mergeRecords(
  base: Record<string, JSONValue>,
  override: Record<string, JSONValue>,
): Record<string, JSONValue> {
  const merged: Record<string, JSONValue> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const existingValue = merged[key];

    if (isJsonObject(existingValue) && isJsonObject(value)) {
      merged[key] = mergeRecords(existingValue, value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

export type ProviderOptionsByProvider = Record<
  string,
  Record<string, JSONValue>
>;

export function mergeProviderOptions(
  defaults: ProviderOptionsByProvider,
  overrides?: ProviderOptionsByProvider,
): ProviderOptionsByProvider {
  if (!overrides || Object.keys(overrides).length === 0) {
    return defaults;
  }

  const merged: ProviderOptionsByProvider = { ...defaults };

  for (const [provider, providerOverrides] of Object.entries(overrides)) {
    const providerDefaults = merged[provider];

    if (!providerDefaults) {
      merged[provider] = providerOverrides;
      continue;
    }

    merged[provider] = mergeRecords(providerDefaults, providerOverrides);
  }

  return merged;
}

export interface GatewayConfig {
  baseURL: string;
  apiKey: string;
}

export interface GatewayOptions {
  devtools?: boolean;
  config?: GatewayConfig;
  providerOptionsOverrides?: ProviderOptionsByProvider;
}

export type { GatewayModelId, LanguageModel, JSONValue };

export function shouldApplyOpenAIReasoningDefaults(modelId: string): boolean {
  return modelId.startsWith("openai/gpt-5");
}

function shouldApplyOpenAITextVerbosityDefaults(modelId: string): boolean {
  return modelId.startsWith("openai/gpt-5.4");
}

export function getProviderOptionsForModel(
  modelId: string,
  providerOptionsOverrides?: ProviderOptionsByProvider,
): ProviderOptionsByProvider {
  const defaultProviderOptions: ProviderOptionsByProvider = {};

  // Apply anthropic defaults
  if (modelId.startsWith("anthropic/")) {
    defaultProviderOptions.anthropic = toProviderOptionsRecord(
      getAnthropicSettings(modelId),
    );
  }

  // OpenAI model responses should never be persisted.
  if (modelId.startsWith("openai/")) {
    defaultProviderOptions.openai = toProviderOptionsRecord({
      store: false,
    } satisfies OpenAIResponsesProviderOptions);
  }

  // Apply OpenAI defaults for all GPT-5 variants to expose encrypted reasoning content.
  // This avoids Responses API failures when `store: false`, e.g.:
  // "Item with id 'rs_...' not found. Items are not persisted when `store` is set to false."
  if (shouldApplyOpenAIReasoningDefaults(modelId)) {
    defaultProviderOptions.openai = mergeRecords(
      defaultProviderOptions.openai ?? {},
      toProviderOptionsRecord({
        reasoningSummary: "detailed",
        include: ["reasoning.encrypted_content"],
      } satisfies OpenAIResponsesProviderOptions),
    );
  }

  if (shouldApplyOpenAITextVerbosityDefaults(modelId)) {
    defaultProviderOptions.openai = mergeRecords(
      defaultProviderOptions.openai ?? {},
      toProviderOptionsRecord({
        textVerbosity: "low",
      } satisfies OpenAIResponsesProviderOptions),
    );
  }

  const providerOptions = mergeProviderOptions(
    defaultProviderOptions,
    providerOptionsOverrides,
  );

  // Enforce OpenAI non-persistence even when custom provider overrides are present.
  if (modelId.startsWith("openai/")) {
    providerOptions.openai = mergeRecords(
      providerOptions.openai ?? {},
      toProviderOptionsRecord({
        store: false,
      } satisfies OpenAIResponsesProviderOptions),
    );
  }

  return providerOptions;
}

export async function gateway(
  modelId: GatewayModelId,
  options: GatewayOptions = {},
): Promise<LanguageModel> {
  const { devtools = false, config, providerOptionsOverrides } = options;

  // Try direct provider first (no AI Gateway needed), then fall back to gateway
  let model: LanguageModel;
  if (config) {
    const customGateway = createGateway({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
    });
    model = customGateway(modelId);
  } else {
    const directModel = await createModelDirect(modelId);
    if (directModel) {
      model = directModel;
    } else {
      model = aiGateway(modelId);
    }
  }

  const providerOptions = getProviderOptionsForModel(
    modelId,
    providerOptionsOverrides,
  );

  if (Object.keys(providerOptions).length > 0 && typeof model === "object") {
    model = wrapLanguageModel({
      model: model as WrapModelInput,
      middleware: defaultSettingsMiddleware({
        settings: { providerOptions },
      }),
    });
  }

  // Apply devtools middleware if requested
  if (devtools && typeof model === "object") {
    model = wrapLanguageModel({
      model: model as WrapModelInput,
      middleware: devToolsMiddleware(),
    });
  }

  return model;
}
