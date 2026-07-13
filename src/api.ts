const ACCESS_TOKEN_KEY = "jarvis.cloud.access-token";

function storedAccessToken() {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  const supplied = url.searchParams.get("access_token");
  if (supplied) {
    localStorage.setItem(ACCESS_TOKEN_KEY, supplied);
    url.searchParams.delete("access_token");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    return supplied;
  }
  return localStorage.getItem(ACCESS_TOKEN_KEY) || "";
}

export function saveAccessToken(token: string) {
  if (typeof window === "undefined" || !token) return;
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function authHeaders(): Record<string, string> {
  const token = storedAccessToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...authHeaders(),
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${path}`);
  }
  return data as T;
}

export function post<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function streamPost<T>(
  path: string,
  body: unknown,
  onDelta: (text: string) => void,
  onProgress?: (phase: string, message: string) => void,
  onEvent?: (event: Record<string, unknown>, envelope: Record<string, unknown>) => void
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify(body)
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Request failed: ${path}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | undefined;
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === "delta") onDelta(String(event.text || ""));
      if (event.type === "progress") onProgress?.(String(event.phase || ""), String(event.message || ""));
      if (event.type === "event" && event.event && typeof event.event === "object") onEvent?.(event.event, event);
      if (event.type === "done") result = event.result as T;
    }
    if (done) break;
  }
  if (buffer.trim()) {
    const event = JSON.parse(buffer);
    if (event.type === "delta") onDelta(String(event.text || ""));
    if (event.type === "progress") onProgress?.(String(event.phase || ""), String(event.message || ""));
    if (event.type === "event" && event.event && typeof event.event === "object") onEvent?.(event.event, event);
    if (event.type === "done") result = event.result as T;
  }
  if (!result) throw new Error("JARVIS stream ended before completion.");
  return result;
}

export function patch<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}
