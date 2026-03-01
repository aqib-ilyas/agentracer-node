import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { init, getConfig, sendTelemetry, observe, track, featureTagStorage } from "../src/index";

describe("init", () => {
  it("sets config with provided options", () => {
    init({ trackerApiKey: "key-123", projectId: "proj-1" });
    const config = getConfig();
    expect(config.trackerApiKey).toBe("key-123");
    expect(config.projectId).toBe("proj-1");
    expect(config.environment).toBe("production");
    expect(config.host).toBe("https://api.agentracer.dev");
  });

  it("merges with defaults", () => {
    init({ trackerApiKey: "k", projectId: "p", environment: "staging", debug: true });
    const config = getConfig();
    expect(config.environment).toBe("staging");
    expect(config.debug).toBe(true);
    expect(config.enabled).toBe(true);
  });
});

describe("sendTelemetry", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    init({ trackerApiKey: "key-1", projectId: "proj-1", enabled: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends payload via fetch", async () => {
    await sendTelemetry({ model: "gpt-4" });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.agentracer.dev/api/ingest");
    expect(options.method).toBe("POST");
    expect(options.headers["x-api-key"]).toBe("key-1");
    expect(JSON.parse(options.body)).toEqual({ model: "gpt-4" });
  });

  it("skips when disabled", async () => {
    init({ trackerApiKey: "k", projectId: "p", enabled: false });
    await sendTelemetry({ model: "gpt-4" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("silently catches fetch errors", async () => {
    fetchSpy.mockRejectedValue(new Error("network error"));
    await expect(sendTelemetry({ model: "gpt-4" })).resolves.toBeUndefined();
  });
});

describe("observe", () => {
  it("propagates feature tag to async context", async () => {
    let captured: string | undefined;
    const fn = observe(async () => {
      captured = featureTagStorage.getStore();
      return "result";
    }, { featureTag: "chatbot" });

    const result = await fn();
    expect(result).toBe("result");
    expect(captured).toBe("chatbot");
  });

  it("propagates feature tag to sync context", () => {
    let captured: string | undefined;
    const fn = observe(() => {
      captured = featureTagStorage.getStore();
      return 42;
    }, { featureTag: "search" });

    const result = fn();
    expect(result).toBe(42);
    expect(captured).toBe("search");
  });
});

describe("track", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    init({ trackerApiKey: "k", projectId: "proj-1", enabled: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends correct telemetry payload", async () => {
    init({ trackerApiKey: "k", projectId: "proj-1", enabled: true, environment: "production" });
    await track({
      model: "gpt-4",
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 200,
      featureTag: "chat",
      provider: "openai",
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body).toEqual({
      project_id: "proj-1",
      provider: "openai",
      model: "gpt-4",
      feature_tag: "chat",
      input_tokens: 100,
      output_tokens: 50,
      cached_tokens: 0,
      latency_ms: 200,
      success: true,
      environment: "production",
    });
  });

  it("uses feature tag from context when not explicitly provided", async () => {
    await featureTagStorage.run("from-context", async () => {
      await track({
        model: "claude-3",
        inputTokens: 10,
        outputTokens: 5,
        latencyMs: 100,
      });
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.feature_tag).toBe("from-context");
    expect(body.provider).toBe("custom");
  });
});
