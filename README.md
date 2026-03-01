# agentracer

Lightweight AI observability for Node.js and TypeScript. Track costs, latency, and token usage across OpenAI, Anthropic, and Gemini with a single line change.

## Installation

```bash
npm install agentracer
```

## Quick Start

**1. Initialize once** (at app startup):

```typescript
import { init } from "agentracer";

init({
  trackerApiKey: process.env.AGENTRACER_API_KEY!,
  projectId: process.env.AGENTRACER_PROJECT_ID!,
});
```

**2. Replace your import:**

```typescript
// Before
import OpenAI from "openai";
const openai = new OpenAI();

// After
import { openai } from "agentracer/openai";
```

That's it. Every call is now tracked with cost, latency, and token usage.

## Usage

### OpenAI

```typescript
import { init } from "agentracer";
import { openai } from "agentracer/openai";

init({
  trackerApiKey: process.env.AGENTRACER_API_KEY!,
  projectId: process.env.AGENTRACER_PROJECT_ID!,
});

const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
  feature_tag: "chatbot", // optional: tag this call
});

console.log(response.choices[0].message.content);
```

### Anthropic

```typescript
import { init } from "agentracer";
import { anthropic } from "agentracer/anthropic";

init({
  trackerApiKey: process.env.AGENTRACER_API_KEY!,
  projectId: process.env.AGENTRACER_PROJECT_ID!,
});

const response = await anthropic.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello!" }],
  feature_tag: "summarizer", // optional: tag this call
});

console.log(response.content[0].text);
```

### Google Gemini

```typescript
import { init } from "agentracer";
import { gemini } from "agentracer/gemini";

init({
  trackerApiKey: process.env.AGENTRACER_API_KEY!,
  projectId: process.env.AGENTRACER_PROJECT_ID!,
});

const model = gemini.getGenerativeModel({ model: "gemini-1.5-pro" });

const result = await model.generateContent({
  contents: [{ role: "user", parts: [{ text: "Hello!" }] }],
  feature_tag: "content-gen", // optional: tag this call
});

console.log(result.response.text());
```

## Custom Client Configuration

If you need to pass custom options to the underlying SDK (API key, base URL, organization, etc.), use the `Tracked*` classes instead of the default proxy exports:

### TrackedOpenAI

```typescript
import { init } from "agentracer";
import { TrackedOpenAI } from "agentracer/openai";

init({
  trackerApiKey: process.env.AGENTRACER_API_KEY!,
  projectId: process.env.AGENTRACER_PROJECT_ID!,
});

const openai = new TrackedOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: "org-xxx",
  baseURL: "https://custom-endpoint.example.com/v1",
});

const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
});
```

### TrackedAnthropic

```typescript
import { init } from "agentracer";
import { TrackedAnthropic } from "agentracer/anthropic";

init({
  trackerApiKey: process.env.AGENTRACER_API_KEY!,
  projectId: process.env.AGENTRACER_PROJECT_ID!,
});

const anthropic = new TrackedAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: "https://custom-endpoint.example.com",
});

const response = await anthropic.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello!" }],
});
```

## Streaming

All providers support streaming. Token usage is automatically tracked after the stream completes.

### OpenAI Streaming

```typescript
import { openai } from "agentracer/openai";

const stream = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Write a poem" }],
  stream: true,
  feature_tag: "poet",
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
// Telemetry is sent automatically after the stream ends
```

### Anthropic Streaming

```typescript
import { anthropic } from "agentracer/anthropic";

const stream = await anthropic.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Write a poem" }],
  stream: true,
  feature_tag: "poet",
});

for await (const event of stream) {
  if (event.type === "content_block_delta") {
    process.stdout.write(event.delta.text ?? "");
  }
}
```

### Gemini Streaming

```typescript
import { gemini } from "agentracer/gemini";

const model = gemini.getGenerativeModel({ model: "gemini-1.5-pro" });

const { stream } = await model.generateContentStream("Write a poem");

for await (const chunk of stream) {
  process.stdout.write(chunk.text());
}
```

> Streaming works transparently -- usage is captured from the final chunk (OpenAI), SSE events (Anthropic), or chunk metadata (Gemini), then sent as a single telemetry event after the stream finishes.

## Feature Tags

Feature tags let you break down costs by feature (e.g., "chatbot", "summarizer", "code-review"). There are two ways to tag calls.

### Option 1: Pass directly

```typescript
const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
  feature_tag: "chatbot",
});
```

### Option 2: Use `observe` for automatic tagging

Wrap a function with `observe` to automatically tag every LLM call inside it:

```typescript
import { init, observe } from "agentracer";
import { openai } from "agentracer/openai";

init({
  trackerApiKey: process.env.AGENTRACER_API_KEY!,
  projectId: process.env.AGENTRACER_PROJECT_ID!,
});

const handleChat = observe(
  async (userMessage: string) => {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: userMessage }],
    });
    return response.choices[0].message.content;
  },
  { featureTag: "chatbot" }
);

// All LLM calls inside handleChat are tagged "chatbot"
const reply = await handleChat("What is TypeScript?");
```

`observe` uses Node.js `AsyncLocalStorage` under the hood, so it works correctly with concurrent requests -- each request gets its own tag even in parallel.

## Agent Runs

Track multi-step AI agent workflows as a single run with individual step tracking:

```typescript
import { init, AgentRun } from "agentracer";
import { openai } from "agentracer/openai";

init({
  trackerApiKey: process.env.AGENTRACER_API_KEY!,
  projectId: process.env.AGENTRACER_PROJECT_ID!,
});

const run = new AgentRun({
  runName: "research-agent",
  featureTag: "research",
  endUserId: "user-123",
});

const result = await run.execute(async () => {
  // Step 1: Plan
  const plan = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: "Plan a research strategy for quantum computing" }],
  });

  // Step 2: Execute
  const research = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "user", content: "Research quantum computing" },
      { role: "assistant", content: plan.choices[0].message.content! },
      { role: "user", content: "Now execute the research plan" },
    ],
  });

  // Step 3: Summarize
  const summary = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "user", content: `Summarize: ${research.choices[0].message.content}` },
    ],
  });

  return summary.choices[0].message.content;
});
```

Each LLM call inside `run.execute()` is automatically:
- Tagged with the run's `featureTag`
- Linked to the run via `runId`
- Recorded as a numbered step with its own token/latency data

### AgentRun Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `runName` | `string` | - | Human-readable name for the run |
| `featureTag` | `string` | `"unknown"` | Feature tag applied to all calls |
| `endUserId` | `string` | - | User ID for per-user cost tracking |
| `runId` | `string` | auto-generated UUID | Custom run ID |

## Manual Tracking

For providers not directly supported, or for custom tracking scenarios, use `track`:

```typescript
import { init, track } from "agentracer";

init({
  trackerApiKey: process.env.AGENTRACER_API_KEY!,
  projectId: process.env.AGENTRACER_PROJECT_ID!,
});

const start = Date.now();

// ... your LLM call here ...

await track({
  model: "gpt-4o",
  inputTokens: 150,
  outputTokens: 50,
  latencyMs: Date.now() - start,
  featureTag: "search",
  provider: "openai",
});
```

### track() Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `model` | `string` | required | Model name |
| `inputTokens` | `number` | required | Tokens sent to the model |
| `outputTokens` | `number` | required | Tokens received from the model |
| `latencyMs` | `number` | required | Round-trip time in milliseconds |
| `featureTag` | `string` | from context or `"unknown"` | Which feature made the call |
| `provider` | `string` | `"custom"` | LLM provider name |
| `cachedTokens` | `number` | `0` | Cached input tokens |
| `success` | `boolean` | `true` | Whether the call succeeded |
| `errorType` | `string` | - | Error class name on failure |
| `endUserId` | `string` | - | User ID for per-user tracking |
| `runId` | `string` | auto from AgentRun | Agent run ID |
| `stepIndex` | `number` | auto from AgentRun | Step number within run |

## Express Example

```typescript
import express from "express";
import { init, observe } from "agentracer";
import { openai } from "agentracer/openai";

init({
  trackerApiKey: process.env.AGENTRACER_API_KEY!,
  projectId: process.env.AGENTRACER_PROJECT_ID!,
  environment: process.env.NODE_ENV ?? "development",
});

const app = express();
app.use(express.json());

const handleChat = observe(
  async (message: string) => {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: message }],
    });
    return response.choices[0].message.content;
  },
  { featureTag: "chatbot" }
);

const handleSummary = observe(
  async (text: string) => {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: `Summarize: ${text}` }],
    });
    return response.choices[0].message.content;
  },
  { featureTag: "summarizer" }
);

app.post("/chat", async (req, res) => {
  const reply = await handleChat(req.body.message);
  res.json({ reply });
});

app.post("/summarize", async (req, res) => {
  const summary = await handleSummary(req.body.text);
  res.json({ summary });
});

app.listen(3000);
```

## Next.js Example

```typescript
// app/api/chat/route.ts
import { init, observe } from "agentracer";
import { openai } from "agentracer/openai";
import { NextResponse } from "next/server";

init({
  trackerApiKey: process.env.AGENTRACER_API_KEY!,
  projectId: process.env.AGENTRACER_PROJECT_ID!,
  environment: process.env.NODE_ENV,
});

const chat = observe(
  async (message: string) => {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: message }],
    });
    return response.choices[0].message.content;
  },
  { featureTag: "chatbot" }
);

export async function POST(req: Request) {
  const { message } = await req.json();
  const reply = await chat(message);
  return NextResponse.json({ reply });
}
```

## Configuration

```typescript
init({
  // Required
  trackerApiKey: "your-api-key",
  projectId: "your-project-id",

  // Optional
  environment: "production", // default: "production"
  host: "https://api.agentracer.dev", // default: Agentracer cloud
  debug: false, // default: false -- logs payloads to console
  enabled: true, // default: true -- set false to disable tracking
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `trackerApiKey` | `string` | required | Your Agentracer API key |
| `projectId` | `string` | required | Your project ID |
| `environment` | `string` | `"production"` | Environment label (production, staging, development) |
| `host` | `string` | `"https://api.agentracer.dev"` | API endpoint |
| `debug` | `boolean` | `false` | Log telemetry payloads to console |
| `enabled` | `boolean` | `true` | Set to `false` to disable all tracking |

## What We Track

Every LLM call sends a single lightweight payload:

| Field | Description |
|-------|-------------|
| `project_id` | Your project identifier |
| `provider` | LLM provider (openai, anthropic, gemini, custom) |
| `model` | Model name (gpt-4o, claude-sonnet-4-20250514, etc.) |
| `feature_tag` | Which feature made the call |
| `input_tokens` | Tokens sent to the model |
| `output_tokens` | Tokens received from the model |
| `cached_tokens` | Cached input tokens (prompt cache hits) |
| `latency_ms` | Round-trip time in milliseconds |
| `success` | Whether the call succeeded |
| `error_type` | Error class name (on failure) |
| `environment` | Environment label |
| `run_id` | Agent run ID (when inside AgentRun.execute) |
| `step_index` | Step number within an agent run |
| `end_user_id` | End user identifier (for per-user cost tracking) |

We never log prompts, responses, or any user data. Just counts and timing.

## Troubleshooting

### Calls are not showing up in the dashboard

1. Verify your API key and project ID are correct.
2. Make sure `init()` is called before any LLM calls.
3. Enable debug mode to inspect payloads:

```typescript
init({
  trackerApiKey: "...",
  projectId: "...",
  debug: true,
});
```

4. Check that `enabled` is not set to `false`.

### TypeScript errors with `feature_tag`

The `feature_tag` parameter is an Agentracer extension, not part of the official OpenAI/Anthropic SDK types. It is stripped before the call is forwarded to the provider. If you get type errors, you can cast the params:

```typescript
const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
  feature_tag: "chatbot",
} as any);
```

Or use `observe` for automatic tagging instead.

### Telemetry is not blocking my LLM calls

Correct -- telemetry is sent asynchronously with a 2-second timeout and failures are silently ignored. Your application is never impacted.

## License

MIT
