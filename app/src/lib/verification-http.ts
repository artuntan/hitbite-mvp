export class VerificationRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// Enforce the byte limit while reading, including chunked requests without a
// Content-Length header. Reject malformed envelopes before any RPC work.
export async function readVerificationRequest(request: Request) {
  const limit = 8192;
  if (Number(request.headers.get("content-length")) > limit)
    throw new VerificationRequestError("Request too large.", 413);
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim() !==
    "application/json"
  )
    throw new VerificationRequestError("Send a JSON request.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new VerificationRequestError("Invalid request.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new VerificationRequestError("Request too large.", 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("Invalid envelope");
    const input = body as Record<string, unknown>;
    if (input.action !== "challenge" && input.action !== "complete")
      throw new VerificationRequestError("Unknown verification action.", 400);
    return input;
  } catch (error) {
    if (error instanceof VerificationRequestError) throw error;
    throw new VerificationRequestError("Invalid request.", 400);
  } finally {
    reader.releaseLock();
  }
}

// The edge firewall may return HTML. Never show its document or a JSON parser
// exception in the investor flow.
export async function readVerificationResponse<T>(
  response: Response,
): Promise<T> {
  if (response.status === 429) {
    const retry = Number(response.headers.get("retry-after"));
    const seconds =
      Number.isFinite(retry) && retry > 0 && retry <= 600
        ? Math.ceil(retry)
        : 60;
    throw new Error(
      `Too many verification attempts. Try again in ${seconds} seconds.`,
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error(
      "Verification is temporarily unavailable. Please try again shortly.",
    );
  if (!response.ok) {
    const error = (body as Record<string, unknown>).error;
    throw new Error(
      typeof error === "string" ? error : "Verification is unavailable.",
    );
  }
  return body as T;
}
