import { getConfig, track, featureTagStorage } from "./index";

let _clientInstance: any = null;

function getClient(opts?: { apiKey?: string }) {
  if (opts?.apiKey) {
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    return new GoogleGenerativeAI(opts.apiKey);
  }
  if (!_clientInstance) {
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    const apiKey =
      process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
    _clientInstance = new GoogleGenerativeAI(apiKey);
  }
  return _clientInstance;
}

/** @internal Test-only: inject a mock client */
export function _setClientForTesting(client: any) {
  _clientInstance = client;
}

function extractFeatureTag(params: any): [string, any] {
  if (
    params &&
    typeof params === "object" &&
    !Array.isArray(params) &&
    params.feature_tag
  ) {
    const { feature_tag, ...remaining } = params;
    return [feature_tag, remaining];
  }
  return [featureTagStorage.getStore() ?? "unknown", params];
}

async function* wrapGeminiStream(
  stream: AsyncIterable<any>,
  modelName: string,
  featureTag: string,
  start: number
) {
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const chunk of stream) {
    const usage = chunk.usageMetadata;
    if (usage) {
      inputTokens = usage.promptTokenCount ?? 0;
      outputTokens = usage.candidatesTokenCount ?? 0;
    }
    yield chunk;
  }

  track({
    model: modelName,
    inputTokens,
    outputTokens,
    latencyMs: Date.now() - start,
    featureTag,
    provider: "gemini",
  }).catch(() => {});
}

function createTrackedModel(model: any, modelName: string) {
  return new Proxy(model, {
    get(target, prop) {
      if (prop === "generateContent") {
        return async (params: any, ...rest: any[]) => {
          const [featureTag, cleanParams] = extractFeatureTag(params);

          const start = Date.now();
          let result: any;
          try {
            result = await target.generateContent(cleanParams, ...rest);
          } catch (err: any) {
            track({
              model: modelName,
              inputTokens: 0,
              outputTokens: 0,
              latencyMs: Date.now() - start,
              featureTag,
              provider: "gemini",
              success: false,
              errorType: err?.constructor?.name ?? "Error",
            }).catch(() => {});
            throw err;
          }

          try {
            const usage = result.response?.usageMetadata;
            track({
              model: modelName,
              inputTokens: usage?.promptTokenCount ?? 0,
              outputTokens: usage?.candidatesTokenCount ?? 0,
              cachedTokens: usage?.cachedContentTokenCount ?? 0,
              latencyMs: Date.now() - start,
              featureTag,
              provider: "gemini",
            }).catch(() => {});
          } catch {
            // never block the response
          }

          return result;
        };
      }

      if (prop === "generateContentStream") {
        return async (params: any, ...rest: any[]) => {
          const [featureTag, cleanParams] = extractFeatureTag(params);

          const start = Date.now();
          const result = await target.generateContentStream(cleanParams, ...rest);

          return {
            ...result,
            stream: wrapGeminiStream(result.stream, modelName, featureTag, start),
            response: result.response,
          };
        };
      }

      const value = target[prop];
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },
  });
}

export const gemini = new Proxy({} as any, {
  get(_, prop) {
    if (prop === "getGenerativeModel") {
      return (params: any, ...rest: any[]) => {
        const client = getClient();
        const modelName = params?.model ?? "unknown";
        const realModel = client.getGenerativeModel(params, ...rest);
        return createTrackedModel(realModel, modelName);
      };
    }

    const client = getClient();
    const value = client[prop];
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});
