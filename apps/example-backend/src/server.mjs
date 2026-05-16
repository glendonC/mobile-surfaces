#!/usr/bin/env node
// Mobile Surfaces example backend.
//
// Single-file Node http server that demonstrates the production shape of a
// Mobile Surfaces backend: receive a token from the mobile app via
// @mobile-surfaces/tokens/forwarder, hold domain state, accept a domain
// event over HTTP, project it to a LiveSurfaceSnapshot via
// @mobile-surfaces/example-domain, and drive APNs via @mobile-surfaces/push.
// Paired with apps/mobile/src/screens/DeliveryExampleScreen.tsx; together
// they close the loop end-to-end.
//
// This is a REFERENCE, not a deployable. The storage layer is an in-memory
// Map that drops on restart on purpose — a production backend stores tokens
// keyed by idempotencyKey in its existing user-data store, and orders in
// whatever the upstream domain is (Postgres, DynamoDB, EventStore). The
// projection family is the part that ports to production unchanged.
//
// Wire-boundary parses are the discipline this file is meant to teach. Both
// the token forwarder input (tokenForwarderRequestSchema) and the snapshot
// output (safeParseSnapshot) cross typed Zod boundaries before persistence
// or dispatch — that's the entire point of the @mobile-surfaces/* contract
// surface. Skip a parse, ship a bug.
//
// Run:
//   APNS_KEY_PATH=./keys/AuthKey_*.p8 \
//   APNS_KEY_ID=ABCDEF1234 \
//   APNS_TEAM_ID=TEAM123456 \
//   APNS_BUNDLE_ID=com.example.mobilesurfaces \
//   APNS_ENV=development \
//   PORT=3000 \
//   node src/server.mjs

import { createServer } from "node:http";
import { URL } from "node:url";
import { z } from "zod";

import {
  deliveryToSnapshot,
  mockTickOrder,
} from "@mobile-surfaces/example-domain";
import {
  createPushClient,
  toApnsAlertPayload,
} from "@mobile-surfaces/push";
import {
  assertSnapshot,
  toLiveActivityContentState,
  toNotificationContentPayload,
} from "@mobile-surfaces/surface-contracts";
import { tokenForwarderRequestSchema } from "@mobile-surfaces/tokens/wire";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT ?? 3000);
const APNS_ENV = process.env.APNS_ENV === "production" ? "production" : "development";

// The push client is optional in this reference so a reader can `node
// src/server.mjs` without APNs credentials and still see the token-receipt
// and domain-event flow. A production backend always has the credentials.
const pushClient =
  process.env.APNS_KEY_PATH && process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_BUNDLE_ID
    ? createPushClient({
        keyPath: process.env.APNS_KEY_PATH,
        keyId: process.env.APNS_KEY_ID,
        teamId: process.env.APNS_TEAM_ID,
        bundleId: process.env.APNS_BUNDLE_ID,
        environment: APNS_ENV,
        // Inherits the SDK's default `maxConcurrentStreams: 900`. Production
        // callers running cluster-mode would also pass `jwtCache` here with
        // a BroadcastChannel-backed implementation; see packages/push/README
        // "Operational notes" for the worked example.
      })
    : undefined;

// ---------------------------------------------------------------------------
// Storage. In-memory on purpose; see file header.
// ---------------------------------------------------------------------------

/** @type {Map<string, import("zod").infer<typeof tokenForwarderRequestSchema>>} */
const tokens = new Map(); // idempotencyKey -> record

/** @type {Map<string, import("@mobile-surfaces/example-domain").DeliveryOrder>} */
const orders = new Map(); // orderId -> order

// ---------------------------------------------------------------------------
// Route helpers
// ---------------------------------------------------------------------------

const advanceBodySchema = z
  .object({
    stage: z.enum(["placed", "preparing", "out_for_delivery", "delivered"]),
  })
  .strict();

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

// Pick the token to use for a given activity-bound surface. Real backends
// thread orderId / userId / activityId through their own keying; this demo
// just returns the most recent active token of the requested kind.
function pickToken(kind) {
  let chosen;
  for (const t of tokens.values()) {
    if (t.kind !== kind) continue;
    if (t.lifecycle !== "active") continue;
    if (!chosen || t.recordedAt > chosen.recordedAt) chosen = t;
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// Domain event -> snapshot -> APNs
// ---------------------------------------------------------------------------

async function dispatchUpdate(order) {
  if (!pushClient) return { skipped: "no APNs credentials configured" };

  // Live Activity update: pick the per-activity token, project the
  // snapshot, validate at the wire boundary, send. assertSnapshot inside
  // deliveryToSnapshot already throws on a bad projection; the explicit
  // assertSnapshot below is belt-and-suspenders for the typed contract.
  const liveActivityToken = pickToken("perActivity");
  if (liveActivityToken) {
    const snapshot = assertSnapshot(deliveryToSnapshot(order, "liveActivity"));
    const contentState = toLiveActivityContentState(snapshot);
    await pushClient.update(liveActivityToken.token, snapshot, {
      // Live Activity content updates default to priority 5 per MS015's
      // budget rules; the snapshot-shaped projection above carries the
      // content state the on-device widget renders.
    });
    return { dispatched: "liveActivity", contentState };
  }

  // No per-activity token yet (mobile app hasn't started a Live Activity).
  // Fall back to a notification-kind push so the user still sees the
  // delivered milestone surface.
  if (order.stage === "delivered") {
    const apnsDeviceToken = pickToken("apnsDevice");
    if (apnsDeviceToken) {
      const snapshot = assertSnapshot(deliveryToSnapshot(order, "notification"));
      const payload = toNotificationContentPayload(snapshot);
      await pushClient.sendNotification(apnsDeviceToken.token, snapshot, {
        // Notification body is the projection-output payload; the SDK
        // wraps it in the aps envelope.
      });
      return { dispatched: "notification", payload };
    }
  }

  return { skipped: "no usable token for this stage" };
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  try {
    // POST /tokens — the mobile token forwarder posts here on every emit.
    if (req.method === "POST" && url.pathname === "/tokens") {
      const body = await readJsonBody(req);
      const parsed = tokenForwarderRequestSchema.safeParse(body);
      if (!parsed.success) {
        json(res, 400, { error: "invalid token-forwarder payload", issues: parsed.error.issues });
        return;
      }
      const existing = tokens.get(parsed.data.idempotencyKey);
      if (existing) {
        // Idempotency: a re-send of the same key with the same recordedAt is
        // a no-op. A later recordedAt for the same key overwrites (MS020:
        // latest-write-wins on rotation).
        if (parsed.data.recordedAt <= existing.recordedAt) {
          json(res, 200, { stored: false, reason: "idempotent" });
          return;
        }
      }
      tokens.set(parsed.data.idempotencyKey, parsed.data);
      json(res, 200, { stored: true });
      return;
    }

    // GET /tokens — inspector. List every token currently held.
    if (req.method === "GET" && url.pathname === "/tokens") {
      json(res, 200, { tokens: Array.from(tokens.values()) });
      return;
    }

    // POST /delivery/:orderId/advance — domain event ingress. Body is
    // `{ stage }`; the server transitions order state and dispatches the
    // matching push.
    if (req.method === "POST" && url.pathname.startsWith("/delivery/") && url.pathname.endsWith("/advance")) {
      const orderId = url.pathname.slice("/delivery/".length, -"/advance".length);
      if (!orderId) {
        json(res, 400, { error: "missing orderId" });
        return;
      }
      const body = await readJsonBody(req);
      const parsed = advanceBodySchema.safeParse(body);
      if (!parsed.success) {
        json(res, 400, { error: "invalid advance payload", issues: parsed.error.issues });
        return;
      }
      // First-touch seed for this orderId. A real backend reads from its
      // own domain store; the seed here is just enough shape to feed the
      // projection family. `mockTickOrder` then bumps stage / updatedAt
      // / etaMinutes / driverName per the documented mapping.
      const now = new Date();
      const previous =
        orders.get(orderId) ??
        ({
          id: orderId,
          restaurant: "Example Restaurant",
          itemCount: 1,
          stage: "placed",
          placedAt: now.toISOString(),
          etaMinutes: 25,
          deepLink: `mobilesurfaces://orders/${orderId}`,
          updatedAt: now.toISOString(),
        });
      const next = mockTickOrder(previous, parsed.data.stage);
      orders.set(orderId, next);
      const dispatch = await dispatchUpdate(next);
      json(res, 200, { order: next, dispatch });
      return;
    }

    // GET /orders/:id — inspector.
    if (req.method === "GET" && url.pathname.startsWith("/orders/")) {
      const orderId = url.pathname.slice("/orders/".length);
      const order = orders.get(orderId);
      if (!order) {
        json(res, 404, { error: "no such order" });
        return;
      }
      json(res, 200, { order });
      return;
    }

    json(res, 404, { error: "no such route", method: req.method, path: url.pathname });
  } catch (err) {
    // Distinguish wire-shape errors (we already 400'd) from internal errors.
    const message = err instanceof Error ? err.message : String(err);
    json(res, 500, { error: "internal", message });
  }
});

server.listen(PORT, () => {
  console.log(`[mobile-surfaces example-backend] listening on http://localhost:${PORT}`);
  console.log(`  APNs environment: ${APNS_ENV}`);
  console.log(`  Push enabled: ${pushClient ? "yes" : "no (APNS_* env vars unset)"}`);
});

// Graceful shutdown for `pnpm start` + Ctrl-C.
async function shutdown() {
  console.log("[mobile-surfaces example-backend] shutting down");
  server.close();
  if (pushClient) await pushClient.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
