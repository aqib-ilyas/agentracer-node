import { AsyncLocalStorage } from "async_hooks";

interface AgentracerConfig {
  trackerApiKey: string;
  projectId: string;
  environment?: string;
  host?: string;
  debug?: boolean;
  enabled?: boolean;
}

let config: AgentracerConfig = {
  trackerApiKey: "",
  projectId: "",
  environment: "production",
  host: "https://api.agentracer.dev",
  debug: false,
  enabled: true,
};

export const featureTagStorage = new AsyncLocalStorage<string>();

export function init(options: AgentracerConfig) {
  config = { ...config, ...options };
}

export function getConfig() {
  return config;
}

export async function sendTelemetry(payload: object): Promise<void> {
  if (!config.enabled) return;

  try {
    if (config.debug) console.log("[agentracer]", payload);

    const response = await fetch(`${config.host}/api/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.trackerApiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // always silent
  }
}

export function observe<T extends (...args: any[]) => any>(
  fn: T,
  options: { featureTag: string }
): T {
  return ((...args: any[]) =>
    featureTagStorage.run(options.featureTag, () => fn(...args))) as T;
}

export async function track(options: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  featureTag?: string;
  environment?: string;
  provider?: string;
}): Promise<void> {
  const currentTag = featureTagStorage.getStore();

  await sendTelemetry({
    project_id: config.projectId,
    provider: options.provider ?? "custom",
    model: options.model,
    feature_tag: options.featureTag ?? currentTag ?? "unknown",
    input_tokens: options.inputTokens,
    output_tokens: options.outputTokens,
    latency_ms: options.latencyMs,
    environment: options.environment ?? config.environment,
  });
}
