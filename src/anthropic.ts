import { getConfig, sendTelemetry, featureTagStorage } from "./index";

let _clientInstance: any = null;

function getClient() {
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

  sendTelemetry({
    project_id: getConfig().projectId,
    provider: "anthropic",
    model,
    feature_tag: featureTag,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    latency_ms: Date.now() - start,
    environment: getConfig().environment,
  }).catch(() => {});
}

export const anthropic = new Proxy({} as any, {
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
          const client = getClient();

          if (cleanParams.stream) {
            const stream = await client.messages.create(cleanParams);
            return wrapAnthropicStream(stream, params.model, featureTag, start);
          }

          const response = await client.messages.create(cleanParams);

          sendTelemetry({
            project_id: getConfig().projectId,
            provider: "anthropic",
            model: params.model,
            feature_tag: featureTag,
            input_tokens: response.usage?.input_tokens ?? 0,
            output_tokens: response.usage?.output_tokens ?? 0,
            latency_ms: Date.now() - start,
            environment: getConfig().environment,
          }).catch(() => {});

          return response;
        },
      };
    }

    return getClient()[prop];
  },
});
