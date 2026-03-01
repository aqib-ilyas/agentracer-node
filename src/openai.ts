import { getConfig, track, featureTagStorage } from "./index";

let _clientInstance: any = null;

function getClient(opts?: any) {
  if (opts) {
    const OpenAI = require("openai").default || require("openai");
    return new OpenAI(opts);
  }
  if (!_clientInstance) {
    const OpenAI = require("openai").default || require("openai");
    _clientInstance = new OpenAI();
  }
  return _clientInstance;
}

/** @internal Test-only: inject a mock client */
export function _setClientForTesting(client: any) {
  _clientInstance = client;
}

async function* wrapOpenAIStream(
  stream: AsyncIterable<any>,
  model: string,
  featureTag: string,
  start: number
) {
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const chunk of stream) {
    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens ?? 0;
      outputTokens = chunk.usage.completion_tokens ?? 0;
    }
    yield chunk;
  }

  track({
    model,
    inputTokens,
    outputTokens,
    latencyMs: Date.now() - start,
    featureTag,
    provider: "openai",
  }).catch(() => {});
}

function createOpenAIProxy(clientGetter: () => any) {
  return new Proxy({} as any, {
    get(_, prop) {
      if (prop === "chat") {
        return {
          completions: {
            create: async (params: any) => {
              const featureTag =
                params.feature_tag ??
                featureTagStorage.getStore() ??
                "unknown";

              const { feature_tag, ...cleanParams } = params;

              const start = Date.now();
              const client = clientGetter();

              if (cleanParams.stream) {
                cleanParams.stream_options = {
                  ...cleanParams.stream_options,
                  include_usage: true,
                };
                const stream = await client.chat.completions.create(cleanParams);
                return wrapOpenAIStream(stream, params.model, featureTag, start);
              }

              let response: any;
              try {
                response = await client.chat.completions.create(cleanParams);
              } catch (err: any) {
                track({
                  model: params.model,
                  inputTokens: 0,
                  outputTokens: 0,
                  latencyMs: Date.now() - start,
                  featureTag,
                  provider: "openai",
                  success: false,
                  errorType: err?.constructor?.name ?? "Error",
                }).catch(() => {});
                throw err;
              }

              track({
                model: params.model,
                inputTokens: response.usage?.prompt_tokens ?? 0,
                outputTokens: response.usage?.completion_tokens ?? 0,
                cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? 0,
                latencyMs: Date.now() - start,
                featureTag,
                provider: "openai",
              }).catch(() => {});

              return response;
            },
          },
        };
      }

      return clientGetter()[prop];
    },
  });
}

export class TrackedOpenAI {
  private _proxy: any;

  constructor(options?: any) {
    const OpenAI = require("openai").default || require("openai");
    const client = new OpenAI(options);
    this._proxy = createOpenAIProxy(() => client);
  }

  get chat() {
    return this._proxy.chat;
  }
}

export const openai = createOpenAIProxy(() => getClient());
