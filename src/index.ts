import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";

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
export const runStorage = new AsyncLocalStorage<AgentRun>();

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
  cachedTokens?: number;
  success?: boolean;
  errorType?: string;
  endUserId?: string;
  runId?: string;
  stepIndex?: number;
}): Promise<void> {
  const currentTag = featureTagStorage.getStore();

  // Auto-detect active AgentRun
  let runId = options.runId;
  let stepIndex = options.stepIndex;
  const activeRun = runStorage.getStore();
  if (activeRun && runId == null) {
    runId = activeRun.runId;
    stepIndex = activeRun._nextStep();
    // Fire-and-forget step recording
    sendRunApi("/api/runs/step", {
      project_id: config.projectId,
      run_id: activeRun.runId,
      step_index: stepIndex,
      step_type: "llm_call",
      model: options.model,
      provider: options.provider ?? "custom",
      input_tokens: options.inputTokens,
      output_tokens: options.outputTokens,
      cached_tokens: options.cachedTokens ?? 0,
      cost_usd: 0,
      latency_ms: options.latencyMs,
      success: options.success ?? true,
      error_type: options.errorType ?? null,
    }).catch(() => {});
  }

  const payload: Record<string, any> = {
    project_id: config.projectId,
    provider: options.provider ?? "custom",
    model: options.model,
    feature_tag: options.featureTag ?? currentTag ?? "unknown",
    input_tokens: options.inputTokens,
    output_tokens: options.outputTokens,
    cached_tokens: options.cachedTokens ?? 0,
    latency_ms: options.latencyMs,
    success: options.success ?? true,
    environment: options.environment ?? config.environment,
  };

  if (options.errorType != null) payload.error_type = options.errorType;
  if (options.endUserId != null) payload.end_user_id = options.endUserId;
  if (runId != null) payload.run_id = runId;
  if (stepIndex != null) payload.step_index = stepIndex;

  await sendTelemetry(payload);
}

async function sendRunApi(path: string, payload: object): Promise<void> {
  if (!config.enabled) return;
  try {
    await fetch(`${config.host}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.trackerApiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // silent
  }
}

export class AgentRun {
  runId: string;
  runName?: string;
  featureTag: string;
  endUserId?: string;
  private stepCounter = 0;

  constructor(options: {
    runName?: string;
    featureTag?: string;
    endUserId?: string;
    runId?: string;
  } = {}) {
    this.runId = options.runId ?? randomUUID();
    this.runName = options.runName;
    this.featureTag = options.featureTag ?? "unknown";
    this.endUserId = options.endUserId;
  }

  /** @internal */
  _nextStep(): number {
    return ++this.stepCounter;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Fire start
    sendRunApi("/api/runs/start", {
      project_id: config.projectId,
      run_id: this.runId,
      run_name: this.runName,
      feature_tag: this.featureTag,
      end_user_id: this.endUserId,
    }).catch(() => {});

    try {
      const result = await runStorage.run(this, () =>
        featureTagStorage.run(this.featureTag, fn)
      );

      // Fire end — completed
      sendRunApi("/api/runs/end", {
        project_id: config.projectId,
        run_id: this.runId,
        status: "completed",
      }).catch(() => {});

      return result;
    } catch (err: any) {
      // Fire end — failed
      sendRunApi("/api/runs/end", {
        project_id: config.projectId,
        run_id: this.runId,
        status: "failed",
        error_type: err?.constructor?.name ?? "Error",
      }).catch(() => {});

      throw err;
    }
  }
}
