// iOS 18 broadcast channel parsers. Apple's channel-management responses
// have several shapes across the create / list / delete endpoints; this
// module normalizes them into a single ChannelInfo type so client.ts can
// stay focused on the request lifecycle.

export interface ChannelInfo {
  channelId: string;
  storagePolicy: "no-storage" | "most-recent-message";
  /**
   * Anything else Apple's response carried for this channel, preserved
   * verbatim. Currently Apple returns only the channel-id + storage policy
   * for `createChannel` and a list of channel-ids for `listChannels`; this
   * field is here for forward-compat.
   */
  raw?: Record<string, unknown>;
}

export function tryParseJson(body: string): Record<string, unknown> | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function tryParseChannelIdFromBody(body: string): string | undefined {
  const parsed = tryParseJson(body);
  if (!parsed) return undefined;
  const candidate =
    parsed["apns-channel-id"] ?? parsed["channel-id"] ?? parsed.channelId;
  return typeof candidate === "string" ? candidate : undefined;
}

export function extractChannelList(
  parsed: Record<string, unknown> | undefined,
): unknown[] {
  if (!parsed) return [];
  const candidate = parsed.channels ?? parsed["all-channels"];
  return Array.isArray(candidate) ? candidate : [];
}

export function normalizeChannelEntry(entry: unknown): ChannelInfo {
  if (typeof entry === "string") {
    return { channelId: entry, storagePolicy: "no-storage" };
  }
  if (entry && typeof entry === "object") {
    const obj = entry as Record<string, unknown>;
    const channelId = String(
      obj["apns-channel-id"] ?? obj["channel-id"] ?? obj.channelId ?? "",
    );
    const policy = obj["message-storage-policy"];
    const storagePolicy: "no-storage" | "most-recent-message" =
      policy === 1 || policy === "most-recent-message"
        ? "most-recent-message"
        : "no-storage";
    return { channelId, storagePolicy, raw: obj };
  }
  return { channelId: "", storagePolicy: "no-storage" };
}
