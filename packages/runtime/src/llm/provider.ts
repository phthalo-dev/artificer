import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  type LanguageModel,
  type LanguageModelMiddleware,
  wrapLanguageModel,
} from 'ai';
import { type LlmSdkPackage, packageForModel } from './catalog.js';

/**
 * `@ai-sdk/google` echoes a generated `id` on `functionCall`/`functionResponse`
 * parts in multi-turn tool calls. Zen proxies to the public Gemini API, which
 * rejects that field ("Unknown name 'id'"). Gemini matches tool calls by name
 * and order, so dropping the id is safe and only affects the serialized request
 * (the AI SDK's own call/result matching already happened upstream).
 */
const stripGoogleToolIds: LanguageModelMiddleware = {
  specificationVersion: 'v3',
  transformParams: async ({ params }) => {
    for (const message of params.prompt) {
      if (!Array.isArray(message.content)) continue;
      for (const part of message.content) {
        if (part.type === 'tool-call' || part.type === 'tool-result') {
          delete (part as { toolCallId?: string }).toolCallId;
        }
      }
    }
    return params;
  },
};

/** Everything the resolver needs to reach the gateway. */
export interface ProviderConfig {
  /** API key for the gateway (Zen key, or an Anthropic/OpenAI key for direct use). */
  apiKey: string;
  /** Gateway base URL, e.g. https://opencode.ai/zen/v1. */
  baseURL: string;
}

/**
 * Lazily-built provider factories, keyed by SDK package + base URL + key, so we
 * don't re-create a client for every call. The factory turns a model id into an
 * AI SDK LanguageModel.
 */
type ModelFactory = (modelId: string) => LanguageModel;

function buildFactory(
  npm: LlmSdkPackage,
  config: ProviderConfig,
): ModelFactory {
  const { apiKey, baseURL } = config;
  switch (npm) {
    case '@ai-sdk/anthropic': {
      const provider = createAnthropic({ apiKey, baseURL });
      return (id) => provider.languageModel(id);
    }
    case '@ai-sdk/openai': {
      const provider = createOpenAI({ apiKey, baseURL });
      // Zen serves GPT-5-class models through the OpenAI Responses API.
      return (id) => provider.responses(id);
    }
    case '@ai-sdk/google': {
      const provider = createGoogleGenerativeAI({ apiKey, baseURL });
      return (id) =>
        wrapLanguageModel({
          model: provider.languageModel(id),
          middleware: stripGoogleToolIds,
        });
    }
    case '@ai-sdk/openai-compatible': {
      const provider = createOpenAICompatible({
        name: 'zen',
        apiKey,
        baseURL,
      });
      return (id) => provider.languageModel(id);
    }
  }
}

const factoryCache = new Map<string, ModelFactory>();

function getFactory(npm: LlmSdkPackage, config: ProviderConfig): ModelFactory {
  const key = `${npm}|${config.baseURL}|${config.apiKey}`;
  let factory = factoryCache.get(key);
  if (!factory) {
    factory = buildFactory(npm, config);
    factoryCache.set(key, factory);
  }
  return factory;
}

/**
 * Resolve a Zen model id to a ready-to-use AI SDK LanguageModel. The model id
 * determines the API shape (Anthropic Messages / OpenAI Responses / Google /
 * OpenAI-compatible chat); the config determines the gateway.
 */
export function resolveLanguageModel(
  modelId: string,
  config: ProviderConfig,
): LanguageModel {
  const npm = packageForModel(modelId);
  return getFactory(npm, config)(modelId);
}
