# MockHTTP

A powerful HTTP client mocking library for Effect-based applications that captures real HTTP responses and replays them during tests. Perfect for creating reliable, deterministic tests without hitting external services.

## Features

- 🎭 **Record & Replay**: Capture real HTTP responses and replay them in tests
- 🚀 **Effect Integration**: Built on top of Effect and @effect/platform
- 💾 **File-based Storage**: Responses stored as files for easy versioning and inspection
- 🔄 **Automatic Recording**: `makeWithRecord` automatically captures missing responses
- 🎯 **Type-safe**: Full TypeScript support with Effect's type system
- 🧪 **Test Framework Agnostic**: Works with any test runner (Bun, Jest, Vitest, etc.)

## Installation

```bash
bun install mockhttp
```

## Quick Start

### Basic Usage - Pure Mock Mode

Use pre-recorded responses only. Fails if response not found:

```typescript
import { MockHttpClient } from "mockhttp";
import { HttpClient } from "@effect/platform";
import { Effect, Layer } from "effect";
import { BunFileSystem } from "@effect/platform-bun";

// Create a mock client layer
const mockLayer = MockHttpClient.make("./.mock_responses").pipe(
  Layer.provide(BunFileSystem.layer)
);

// Use in your tests
const program = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const response = yield* client.get("https://api.example.com/users");
  return yield* response.json;
});

// Run with mock
const result = await program.pipe(
  Effect.provide(mockLayer),
  Effect.runPromise
);
```

### Record & Replay Mode

Automatically records responses for missing mocks:

```typescript
import { FetchHttpClient } from "@effect/platform";

const mockWithRecordLayer = MockHttpClient.makeWithRecord("./.mock_responses").pipe(
  Layer.provide(BunFileSystem.layer),
  Layer.provide(FetchHttpClient.layer) // Real client for recording
);

// First run: makes real HTTP request and saves response
// Subsequent runs: uses saved response
const program = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const response = yield* client.get("https://httpbin.org/get");
  return yield* response.json;
});
```

## How It Works

### Response Storage

MockHTTP stores HTTP responses as files in the specified directory. Each request is uniquely identified by:
- HTTP method
- Full URL (including query parameters)

The filename is a base64url encoding of `"METHOD URL"` with `.http` extension.

### Response Format

Responses are stored in raw HTTP format:

```
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 123

{"data": "response body"}
```

### Serialization Process

1. **Capturing**: When a real response is received, it's serialized with status line, headers, and body
2. **Storage**: The serialized response is saved to disk using Effect's FileSystem
3. **Replay**: When the same request is made, the response is deserialized and returned

## API Reference

### `MockHttpClient.make(dir?: string)`

Creates a pure mock client that only uses pre-recorded responses.

- `dir`: Directory to store/read responses (default: `./.mock_responses`)
- Returns: `Layer<HttpClient.HttpClient, never, FileSystem.FileSystem>`

### `MockHttpClient.makeWithRecord(dir?: string)`

Creates a recording mock client that captures missing responses.

- `dir`: Directory to store/read responses (default: `./.mock_responses`)
- Returns: `Layer<HttpClient.HttpClient, never, FileSystem.FileSystem>`
- Requires: An actual HttpClient layer (like FetchHttpClient) for recording

### Response Serialization

```typescript
// Serialize a response to wire format
const serializeResponse: (
  res: HttpClientResponse
) => Effect<Uint8Array, ResponseError, never>

// Deserialize from wire format
const deserializeResponse: (
  bytes: Uint8Array,
  req: HttpClientRequest
) => HttpClientResponse
```

## Testing Patterns

### Using with Bun Test

```typescript
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { BunFileSystem } from "@effect/platform-bun";
import { FetchHttpClient, HttpClient } from "@effect/platform";
import { MockHttpClient } from "mockhttp";

// Helper for Effect-based tests
export function itEffect<A, E>(
  name: string,
  eff: () => Effect<A, E, never>,
  opts?: { timeoutMs?: number }
) {
  return it(name, async () =>
    await (opts?.timeoutMs
      ? eff().pipe(Effect.timeout(opts.timeoutMs))
      : eff()
    ).pipe(
      Effect.catchAllCause((cause) =>
        Effect.sync(() => {
          throw new Error(Cause.pretty(cause));
        })
      ),
      Effect.runPromise
    )
  );
}

describe("API Tests", () => {
  const mockLayer = MockHttpClient.makeWithRecord("./tests/.mock_responses").pipe(
    Layer.provide(BunFileSystem.layer),
    Layer.provide(FetchHttpClient.layer)
  );

  itEffect("should fetch user data", () =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const response = yield* client.get("https://api.example.com/user/123");
      const user = yield* response.json;
      expect(user.id).toBe(123);
    }).pipe(Effect.provide(mockLayer))
  );
});
```

### Organizing Mock Files

```
project/
├── src/
├── tests/
│   ├── .mock_responses/
│   │   ├── R0VUIGF_base64_encoded_request.http
│   │   └── UE9TVCBh_base64_encoded_request.http
│   └── api.test.ts
└── package.json
```

### CI/CD Considerations

1. **Commit mock files**: Add `.mock_responses` to version control
2. **Deterministic tests**: Tests always use the same responses
3. **Update mocks**: Delete specific files to re-record responses
4. **Clean mocks**: `rm -rf .mock_responses` to re-record all

## Advanced Usage

### Custom Storage Directory

```typescript
const customMockLayer = MockHttpClient.make("./test-fixtures/http-mocks").pipe(
  Layer.provide(BunFileSystem.layer)
);
```

### Selective Recording

```typescript
// Use different layers for different test suites
const integrationMocks = MockHttpClient.makeWithRecord("./mocks/integration");
const unitMocks = MockHttpClient.make("./mocks/unit");
```

### Error Handling

```typescript
const program = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const response = yield* client.get("https://api.example.com/data");
  return yield* response.json;
}).pipe(
  Effect.catchTag("RequestError", (error) =>
    Effect.succeed({ fallback: true })
  )
);
```

## Best Practices

1. **Organize by Feature**: Group mock files by feature or API endpoint
2. **Version Control**: Commit mock files for reproducible tests
3. **Regular Updates**: Periodically refresh mocks to catch API changes
4. **Review Changes**: Review mock file diffs to spot API changes
5. **Environment Separation**: Use different mock directories for different environments

## Troubleshooting

### Mock Not Found

If you get a file not found error, the mock doesn't exist yet:
- Switch to `makeWithRecord` to capture it
- Or manually create the mock file

### Stale Mocks

If tests pass but production fails:
- Delete the mock file to force re-recording
- Compare old vs new mock to see what changed

### Debugging

Check the `.mock_responses` directory to see:
- What requests are being made
- What responses are being returned
- File naming patterns

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT