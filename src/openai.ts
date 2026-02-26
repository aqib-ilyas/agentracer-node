import { getConfig, sendTelemetry, featureTagStorage } from "./index";

let _clientInstance: any = null;

function getClient() {
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

  sendTelemetry({
    project_id: getConfig().projectId,
    provider: "openai",
    model,
    feature_tag: featureTag,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    latency_ms: Date.now() - start,
    environment: getConfig().environment,
  }).catch(() => {});
}

export const openai = new Proxy({} as any, {
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
            const client = getClient();

            if (cleanParams.stream) {
              cleanParams.stream_options = {
                ...cleanParams.stream_options,
                include_usage: true,
              };
              const stream = await client.chat.completions.create(cleanParams);
              return wrapOpenAIStream(stream, params.model, featureTag, start);
            }

            const response = await client.chat.completions.create(cleanParams);

            sendTelemetry({
              project_id: getConfig().projectId,
              provider: "openai",
              model: params.model,
              feature_tag: featureTag,
              input_tokens: response.usage?.prompt_tokens ?? 0,
              output_tokens: response.usage?.completion_tokens ?? 0,
              latency_ms: Date.now() - start,
              environment: getConfig().environment,
            }).catch(() => {});

            return response;
          },
        },
      };
    }

    return getClient()[prop];
  },
});
