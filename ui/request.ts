export class RequestError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}
export async function requestJson<T>(
  path: string,
  method: string,
  body: unknown,
  token: string,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(method === "GET" ? 15000 : 190000);
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok)
      throw new RequestError(
        result.error || "request_failed",
        result.message ||
          "Relay rejected this request. Reload the current state before retrying.",
        response.status,
      );
    signal?.throwIfAborted();
    return result as T;
  } catch (error) {
    if (signal?.aborted)
      throw new DOMException("Stopped waiting", "AbortError");
    if (error instanceof RequestError) throw error;
    throw new RequestError(
      timeout.aborted ? "request_timeout" : "connection_failed",
      timeout.aborted
        ? "Relay did not respond in time. Reload state before retrying; a submitted operation may have committed."
        : "Relay could not be reached or returned an unreadable response. Check the local server, then reload state before retrying.",
    );
  }
}
export function sessionToken() {
  try {
    return sessionStorage.getItem("relay-token") || "";
  } catch {
    return "";
  }
}
export function saveSessionToken(token: string) {
  try {
    if (token) sessionStorage.setItem("relay-token", token);
    else sessionStorage.removeItem("relay-token");
  } catch {
    /* Memory-only access remains available when storage is blocked. */
  }
}
