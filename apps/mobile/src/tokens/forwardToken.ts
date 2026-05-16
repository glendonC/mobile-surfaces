// Send a single token upsert to a user-supplied backend URL. The demo
// harness exposes a "Backend URL" text input that callers wire to this
// function; when the URL is empty the call is a no-op so the demo works
// fully offline.
//
// Body shape (documented contract — production servers can rely on it):
//
//   {
//     "kind":        "pushToStart" | "perActivity" | "apnsDevice",
//     "token":       "<hex>",
//     "activityId":  "<id>" | undefined,
//     "environment": "development" | "production",
//     "recordedAt":  "<ISO-8601>"
//   }
//
// No auth, no batching, no retries. The next rotation overwrites the
// previous entry — that IS the MS020 lesson made executable: the server
// should treat every POST as authoritative and last-write-wins by
// (kind, activityId?). Networks throw, but the user is expected to
// surface the error in their dashboard rather than the SDK retrying
// silently.

import type { StoredToken } from "./useTokenStore.ts";

export type ForwardResult =
  | { kind: "skipped"; reason: "empty-url" }
  | { kind: "ok"; status: number }
  | { kind: "error"; message: string };

const TIMEOUT_MS = 5_000;

export async function forwardToken(
  url: string,
  token: StoredToken,
): Promise<ForwardResult> {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return { kind: "skipped", reason: "empty-url" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(trimmed, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(token),
      signal: controller.signal,
    });
    return { kind: "ok", status: res.status };
  } catch (err) {
    return {
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}
