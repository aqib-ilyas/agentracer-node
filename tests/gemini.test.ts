import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { init, featureTagStorage } from "../src/index";
import { gemini, _setClientForTesting } from "../src/gemini";

const mockGenerateContent = vi.fn();
const mockGenerateContentStream = vi.fn();

let fetchSpy: ReturnType<typeof vi.fn>;
let telemetryPayloads: any[];

beforeEach(() => {
  telemetryPayloads = [];
  fetchSpy = vi.fn().mockImplementation(async (_url: string, options: any) => {
    telemetryPayloads.push(JSON.parse(options.body));
    return { ok: true };
  });
  vi.stubGlobal("fetch", fetchSpy);
  init({ trackerApiKey: "key", projectId: "proj-1", enabled: true });
  mockGenerateContent.mockReset();
  mockGenerateContentStream.mockReset();
  _setClientForTesting({
    getGenerativeModel: () => ({
      generateContent: mockGenerateContent,
      generateContentStream: mockGenerateContentStream,
    }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("gemini non-streaming", () => {
  it("sends telemetry with correct tokens", async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 35 },
        text: () => "Hello!",
      },
    });

    const model = gemini.getGenerativeModel({ model: "gemini-pro" });
    const result = await model.generateContent("Hi there");

    expect(result.response.usageMetadata.promptTokenCount).toBe(20);
    await new Promise((r) => setTimeout(r, 10));
    expect(telemetryPayloads).toHaveLength(1);
    expect(telemetryPayloads[0]).toMatchObject({
      provider: "gemini",
      model: "gemini-pro",
      input_tokens: 20,
      output_tokens: 35,
      project_id: "proj-1",
    });
  });

  it("captures model name from getGenerativeModel params", async () => {
    mockGenerateContent.mockResolvedValue({
      response: { usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } },
    });

    const model = gemini.getGenerativeModel({ model: "gemini-1.5-flash" });
    await model.generateContent("test");

    await new Promise((r) => setTimeout(r, 10));
    expect(telemetryPayloads[0].model).toBe("gemini-1.5-flash");
  });

  it("uses feature_tag from context", async () => {
    mockGenerateContent.mockResolvedValue({
      response: { usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } },
    });

    const model = gemini.getGenerativeModel({ model: "gemini-pro" });
    await featureTagStorage.run("embed-feature", async () => {
      await model.generateContent("test");
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(telemetryPayloads[0].feature_tag).toBe("embed-feature");
  });

  it("does not throw when telemetry fails", async () => {
    fetchSpy.mockRejectedValue(new Error("fail"));
    mockGenerateContent.mockResolvedValue({
      response: { usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 } },
    });

    const model = gemini.getGenerativeModel({ model: "gemini-pro" });
    const result = await model.generateContent("test");
    expect(result).toBeDefined();
  });
});

describe("gemini streaming", () => {
  it("wraps stream and sends telemetry after consumption", async () => {
    const chunks = [
      { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 }, text: () => "Hel" },
      { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 12 }, text: () => "lo" },
      { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 18 }, text: () => "!" },
    ];

    mockGenerateContentStream.mockResolvedValue({
      stream: (async function* () {
        for (const chunk of chunks) yield chunk;
      })(),
      response: Promise.resolve({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 18 } }),
    });

    const model = gemini.getGenerativeModel({ model: "gemini-pro" });
    const result = await model.generateContentStream("Hello");

    const received: any[] = [];
    for await (const chunk of result.stream) {
      received.push(chunk);
    }

    expect(received).toHaveLength(3);
    await new Promise((r) => setTimeout(r, 10));
    expect(telemetryPayloads).toHaveLength(1);
    expect(telemetryPayloads[0]).toMatchObject({
      provider: "gemini",
      model: "gemini-pro",
      input_tokens: 10,
      output_tokens: 18,
    });
  });

  it("preserves response promise on stream result", async () => {
    const responseData = { usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10 } };
    mockGenerateContentStream.mockResolvedValue({
      stream: (async function* () {
        yield { usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10 } };
      })(),
      response: Promise.resolve(responseData),
    });

    const model = gemini.getGenerativeModel({ model: "gemini-pro" });
    const result = await model.generateContentStream("test");

    const resolvedResponse = await result.response;
    expect(resolvedResponse).toEqual(responseData);
  });
});
