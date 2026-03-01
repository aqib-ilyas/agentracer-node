import { getConfig, track, featureTagStorage } from "./index";

let _clientInstance: any = null;

function getClient(opts?: any) {
  if (opts) {
    const Anthropic = require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");
    return new Anthropic(opts);
  }
  if (!_clientInstance) {
    const Anthropic = require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");
    _clientInstance = new Anthropic();
  }
  return _clientInstance;
}

/** @internal Test-only: inject a mock client */
export function _setClientForTesting(client: any) {
  _clientInstance = client;
}

async function* wrapAnthropicStream(
  stream: AsyncIterable<any>,
  model: string,
  featureTag: string,
  start: number
) {
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const event of stream) {
    if (event.type === "message_start" && event.message?.usage) {
      inputTokens = event.message.usage.input_tokens ?? 0;
    }
    if (event.type === "message_delta" && event.usage) {
      outputTokens = event.usage.output_tokens ?? 0;
    }
    yield event;
  }

  track({
    model,
    inputTokens,
    outputTokens,
    latencyMs: Date.now() - start,
    featureTag,
    provider: "anthropic",
  }).catch(() => {});
}

function createAnthropicProxy(clientGetter: () => any) {
  return new Proxy({} as any, {
    get(_, prop) {
      if (prop === "messages") {
        return {
          create: async (params: any) => {
            const featureTag =
              params.feature_tag ??
              featureTagStorage.getStore() ??
              "unknown";

            const { feature_tag, ...cleanParams } = params;

            const start = Date.now();
            const client = clientGetter();

            if (cleanParams.stream) {
              const stream = await client.messages.create(cleanParams);
              return wrapAnthropicStream(stream, params.model, featureTag, start);
            }

            let response: any;
            try {
              response = await client.messages.create(cleanParams);
            } catch (err: any) {
              track({
                model: params.model,
                inputTokens: 0,
                outputTokens: 0,
                latencyMs: Date.now() - start,
                featureTag,
                provider: "anthropic",
                success: false,
                errorType: err?.constructor?.name ?? "Error",
              }).catch(() => {});
              throw err;
            }

            track({
              model: params.model,
              inputTokens: response.usage?.input_tokens ?? 0,
              outputTokens: response.usage?.output_tokens ?? 0,
              cachedTokens: response.usage?.cache_read_input_tokens ?? 0,
              latencyMs: Date.now() - start,
              featureTag,
              provider: "anthropic",
            }).catch(() => {});

            return response;
          },
        };
      }

      return clientGetter()[prop];
    },
  });
}

export class TrackedAnthropic {
  private _proxy: any;

  constructor(options?: any) {
    const Anthropic = require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");
    const client = new Anthropic(options);
    this._proxy = createAnthropicProxy(() => client);
  }

  get messages() {
    return this._proxy.messages;
  }
}

export const anthropic = createAnthropicProxy(() => getClient());
