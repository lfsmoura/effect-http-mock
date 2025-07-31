import {
	FileSystem,
	type HttpClientRequest,
	HttpClientResponse,
	HttpClient,
	HttpClientError,
} from "@effect/platform";
import { Effect, Layer } from "effect";

const CRLF = "\r\n";
const SEP = Buffer.from("\r\n\r\n");

/** Serialize full HTTP response (status + headers + body) */
export const serializeResponse = (res: HttpClientResponse.HttpClientResponse) =>
	Effect.gen(function* () {
		const ab = yield* res.arrayBuffer; // Effect<ArrayBuffer, ResponseError, never>
		const body = Buffer.from(ab);

		let head = `HTTP/1.1 ${res.status}${CRLF}`;
		for (const [k, v] of Object.entries(res.headers)) {
			head += `${k}: ${v}${CRLF}`;
		}
		head += CRLF;

		return Buffer.concat([Buffer.from(head, "utf8"), body]) as Uint8Array;
	});

/** Deserialize from wire bytes to HttpClientResponse */
export function deserializeResponse(
	bytes: Uint8Array,
	req: HttpClientRequest.HttpClientRequest,
): HttpClientResponse.HttpClientResponse {
	const buf = Buffer.from(bytes);
	const i = buf.indexOf(SEP);
	if (i < 0) throw new Error("Malformed response: missing CRLFCRLF");

	const head = buf.subarray(0, i).toString("utf8");
	const body = buf.subarray(i + SEP.length);

	const lines = head.split(CRLF);
	const statusLine = lines.shift() ?? "";
	const m = /^HTTP\/\d\.\d\s+(\d{3})(?:\s+.*)?$/.exec(statusLine);
	if (!m) throw new Error(`Bad status line: ${statusLine}`);
	const status = Number(m[1]);

	const headers = new Headers();
	for (const line of lines) {
		if (!line) continue;
		const p = line.indexOf(":");
		if (p > 0)
			headers.append(line.slice(0, p).trim(), line.slice(p + 1).trim());
	}

	const web = new Response(body, { status, headers });
	// order is (request, response)
	return HttpClientResponse.fromWeb(req, web);
}

/** FS storage */
const fileKey = (req: HttpClientRequest.HttpClientRequest) =>
	Buffer.from(`${req.method} ${req.url.toString()}`).toString("base64url") +
	".http";

const makeStorage = (dir: string) => {
	const pathFor = (req: HttpClientRequest.HttpClientRequest) =>
		`${dir}/${fileKey(req)}`;
	return {
		save: (
			request: HttpClientRequest.HttpClientRequest,
			response: HttpClientResponse.HttpClientResponse,
		) =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const bytes = yield* serializeResponse(response); // Uint8Array
				yield* fs.makeDirectory(dir, { recursive: true });
				yield* fs.writeFile(pathFor(request), bytes);
			}),

		load: (request: HttpClientRequest.HttpClientRequest) =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const bytes = yield* fs.readFile(pathFor(request)); // Uint8Array
				return deserializeResponse(bytes, request);
			}),
	};
};

const toRequestError =
	(req: HttpClientRequest.HttpClientRequest) =>
	(): HttpClientError.HttpClientError =>
		new HttpClientError.RequestError({
			request: req,
			reason: "Transport",
		});

/** ---------- mock client ---------- */

export const MockHttpClient = {
	/** Returns a Layer that provides HttpClient by reading responses from disk. */
	make: (
		dir = "./.mock_responses",
	): Layer.Layer<HttpClient.HttpClient, never, FileSystem.FileSystem> =>
		Layer.effect(
			HttpClient.HttpClient,
			Effect.gen(function* ($: Effect.Adapter) {
				const fs = yield* $(FileSystem.FileSystem); // capture FS once
				const storage = makeStorage(dir);

				// The handler must return Effect<Resp, HttpClientError, never>
				const client = HttpClient.make((req) =>
					storage.load(req).pipe(
						// satisfy R = never by providing fs here
						Effect.provideService(FileSystem.FileSystem, fs),
						// satisfy E = HttpClientError
						Effect.mapError(toRequestError(req)),
					),
				);

				return client;
			}),
		),
	makeWithRecord: (dir = "./.mock_responses") =>
		Layer.effect(
			HttpClient.HttpClient,
			Effect.gen(function* ($: Effect.Adapter) {
				const fs = yield* $(FileSystem.FileSystem); // capture FS once
				const client = yield* $(HttpClient.HttpClient);
				const storage = makeStorage(dir);

				// The handler must return Effect<Resp, HttpClientError, never>
				const mockClient = HttpClient.make((req) =>
					storage.load(req).pipe(
						// satisfy R = never by providing fs here
						Effect.provideService(FileSystem.FileSystem, fs),
						Effect.catchAll(() => {
							return Effect.gen(function* () {
								const response = yield* client.execute(req);
								yield* storage
									.save(req, response)
									.pipe(Effect.provideService(FileSystem.FileSystem, fs));
								return response;
							}).pipe(Effect.mapError(toRequestError(req)));
						}),
					),
				);

				return mockClient;
			}),
		),
};
