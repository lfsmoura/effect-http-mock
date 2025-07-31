import { describe, expect, it } from "bun:test";
import { Cause, Effect, Layer, Schema } from "effect";
import { BunFileSystem } from "@effect/platform-bun";
import {
	FetchHttpClient,
	HttpClient,
	HttpClientResponse,
} from "@effect/platform";
import { MockHttpClient } from "../index.js";

/**
 * Runs an Effect inside `it`, assuming R = never (you must provide layers in the test).
 * On failure, pretty-prints the full Cause and throws a single Error so the test fails
 * without crashing the whole run.
 */
export function itEffect<A = void, E = unknown>(
	name: string,
	eff: () => Effect.Effect<A, E, never>,
	opts?: { timeoutMs?: number },
) {
	return it(
		name,
		async () =>
			await (opts?.timeoutMs
				? eff().pipe(Effect.timeout(opts.timeoutMs))
				: eff()
			).pipe(
				Effect.catchAllCause((cause) =>
					Effect.sync(() => {
						const pretty = Cause.pretty(cause);
						throw new Error(pretty);
					}),
				),
				Effect.runPromise,
			),
	);
}

const mockWithRecord = MockHttpClient.makeWithRecord(
	"./tests/.mock_responses",
).pipe(
	Layer.provide(BunFileSystem.layer),
	Layer.provide(FetchHttpClient.layer),
);

const pureMock = MockHttpClient.make("./tests/.mock_responses").pipe(
	Layer.provide(BunFileSystem.layer),
);

describe("MockHttpClient", () => {
	itEffect("should return a mock http client", () =>
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient;
			expect(client).toBeDefined();
		}).pipe(Effect.provide(mockWithRecord)),
	);

	itEffect("should return a cached response", () =>
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient;
			const response = yield* client.get("https://httpbin.org/get");
			expect(response).toBeDefined();
		}).pipe(Effect.provide(mockWithRecord)),
	);
});

describe("PureMockHttpClient", () => {
	itEffect("should return a mock http client", () =>
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient;
			expect(client).toBeDefined();
		}).pipe(Effect.provide(pureMock)),
	);

	itEffect("should return a cached response", () =>
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient;
			const response = yield* client.get("https://httpbin.org/get");
			expect(response).toBeDefined();
			expect(response.status).toBe(200);
			const json = yield* HttpClientResponse.schemaBodyJson(Schema.Any)(
				response,
			);
			expect(json.origin).toBe("55.55.55.55");
			expect(json.url).toBe("https://httpbin.org/get");
			expect(json.args).toBeDefined();
		}).pipe(Effect.provide(pureMock)),
	);
});
