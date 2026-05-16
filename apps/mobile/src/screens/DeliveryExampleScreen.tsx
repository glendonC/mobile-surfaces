// Production-shape example. The Delivery tab is the reference for a real
// Mobile Surfaces app: a single domain object (DeliveryOrder), one
// projection family (deliveryToSnapshot), and every snapshot that crosses
// the wire boundary is parsed via safeParseSnapshot first. The
// mockTickOrder() function stands in for a backend webhook; production
// code emits the same shape from a server through @mobile-surfaces/push.
//
// The Diagnostics tab next door is the testing appliance. Look here when
// you want to read "how should I structure my app"; look there when you
// want to figure out why a surface is silently empty.

import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Notifications from "expo-notifications";
import {
  safeParseSnapshot,
  surfaceFixtureSnapshots,
  toLiveActivityContentState,
  toNotificationContentPayload,
  type LiveSurfaceSnapshot,
  type LiveSurfaceSnapshotLiveActivity,
  type LiveSurfaceSnapshotNotification,
} from "@mobile-surfaces/surface-contracts";
import { useTokenStore } from "@mobile-surfaces/tokens/react";
import { surfaceColors } from "../theme";
import { liveActivityAdapter } from "../liveActivity";
import {
  deliveryToSnapshot,
  initialDeliveryOrder,
  mockTickOrder,
  type DeliveryOrder,
  type DeliveryStage,
} from "@mobile-surfaces/example-domain";
import {
  refreshLockAccessorySurface,
  refreshStandbySurface,
  refreshWidgetSurface,
  toggleControlSurface,
} from "../surfaceStorage";
import { TrapErrorCard } from "../components/TrapErrorCard";

const STAGE_BUTTONS: Array<{ stage: DeliveryStage; label: string }> = [
  { stage: "placed", label: "Place order" },
  { stage: "preparing", label: "Start kitchen" },
  { stage: "out_for_delivery", label: "Out for delivery" },
  { stage: "delivered", label: "Delivered" },
];

export function DeliveryExampleScreen() {
  const [order, setOrder] = useState<DeliveryOrder>(() =>
    initialDeliveryOrder(),
  );
  const [activityId, setActivityId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [inboundJson, setInboundJson] = useState<string>("");
  const [inboundResult, setInboundResult] = useState<
    | { kind: "idle" }
    | { kind: "ok"; snapshot: LiveSurfaceSnapshot }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  // MS016 / MS020 / MS021: subscribe-via-store-only. The token store
  // owns latest-write-wins on rotation and terminal-state cleanup; the
  // screen reads `tokens` for display and never wires raw listeners.
  const tokenStore = useTokenStore({
    adapter: liveActivityAdapter,
    environment: "development",
    // The example uses a mock forwarder that logs to console. Real apps
    // wire `createTokenForwarder({ url: ... })` from
    // @mobile-surfaces/tokens/forwarder against their backend.
    forwarder: useMemo(
      () => ({
        async forward(record) {
          // eslint-disable-next-line no-console
          console.log(
            "[delivery] would forward token to backend:",
            record.kind,
            record.token.slice(0, 12) + "…",
          );
          return { kind: "ok" as const, status: 200, attempts: 1 };
        },
      }),
      [],
    ),
  });

  const activityIdRef = useRef<string | null>(null);
  activityIdRef.current = activityId;

  const projectAndRunLiveActivity = useCallback(
    async (nextOrder: DeliveryOrder) => {
      // Every emission crosses safeParseSnapshot via deliveryToSnapshot,
      // then toLiveActivityContentState narrows to the wire-shaped
      // ContentState. The adapter parses again at the bridge boundary
      // (MS038) so a domain bug shows up at the call site here, not
      // silently on the Lock Screen.
      const snapshot = deliveryToSnapshot(
        nextOrder,
        "liveActivity",
      ) as LiveSurfaceSnapshotLiveActivity;
      const contentState = toLiveActivityContentState(snapshot);
      if (activityIdRef.current === null) {
        const result = await liveActivityAdapter.start(
          snapshot.surfaceId,
          snapshot.liveActivity.modeLabel,
          contentState,
        );
        setActivityId(result.id);
        return result.id;
      }
      await liveActivityAdapter.update(activityIdRef.current, contentState);
      return activityIdRef.current;
    },
    [],
  );

  const writeNonActivitySurfaces = useCallback(
    async (nextOrder: DeliveryOrder) => {
      // Widget / control / lockAccessory / standby all share one
      // surfaceId per order. Writing in sequence keeps the App Group
      // container in a consistent shape across surfaces.
      const widget = deliveryToSnapshot(nextOrder, "widget");
      const control = deliveryToSnapshot(nextOrder, "control");
      const lockAccessory = deliveryToSnapshot(nextOrder, "lockAccessory");
      const standby = deliveryToSnapshot(nextOrder, "standby");
      if (widget.kind === "widget") await refreshWidgetSurface(widget);
      if (control.kind === "control")
        // The control fixture seeds value=false; production code reads the
        // current tip-toggle from wherever it lives.
        await toggleControlSurface(control, control.control.state ?? false);
      if (lockAccessory.kind === "lockAccessory")
        await refreshLockAccessorySurface(lockAccessory);
      if (standby.kind === "standby") await refreshStandbySurface(standby);
    },
    [],
  );

  const fireDeliveredNotification = useCallback(
    async (nextOrder: DeliveryOrder) => {
      const snapshot = deliveryToSnapshot(
        nextOrder,
        "notification",
      ) as LiveSurfaceSnapshotNotification;
      const payload = toNotificationContentPayload(snapshot);
      // expo-notifications' scheduleNotificationAsync accepts the
      // alert / category fields directly; the surface-payload sidecar
      // rides on `data` so the host can route on it.
      await Notifications.scheduleNotificationAsync({
        content: {
          title: payload.aps.alert.title,
          ...(payload.aps.alert.subtitle
            ? { subtitle: payload.aps.alert.subtitle }
            : {}),
          body: payload.aps.alert.body,
          categoryIdentifier: snapshot.notification.category,
          data: { liveSurface: payload.liveSurface },
        },
        trigger: {
          seconds: 1,
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        },
      });
    },
    [],
  );

  const transitionTo = useCallback(
    async (stage: DeliveryStage) => {
      setBusy(true);
      setError(null);
      setStatus(null);
      try {
        const next = mockTickOrder(order, stage);
        setOrder(next);
        await projectAndRunLiveActivity(next);
        await writeNonActivitySurfaces(next);
        if (stage === "delivered" || stage === "out_for_delivery") {
          await fireDeliveredNotification(next);
        }
        setStatus(`Advanced to ${stage}`);
      } catch (e) {
        setError(e);
      } finally {
        setBusy(false);
      }
    },
    [
      order,
      projectAndRunLiveActivity,
      writeNonActivitySurfaces,
      fireDeliveredNotification,
    ],
  );

  const handleReset = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (activityId) {
        await liveActivityAdapter.end(activityId, "immediate");
        setActivityId(null);
      }
      setOrder(initialDeliveryOrder());
      setStatus("Reset to fresh order");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }, [activityId]);

  const handleSimulateBackendPayload = useCallback(() => {
    // Seed the textarea with the wire shape of the current order. This
    // is the "I just got a webhook" demo: a backend pushes the JSON
    // below, the host parses it against the contract, then projects
    // and forwards as usual.
    const snapshot = deliveryToSnapshot(order, "liveActivity");
    setInboundJson(JSON.stringify(snapshot, null, 2));
    setInboundResult({ kind: "idle" });
  }, [order]);

  const handleParseInbound = useCallback(() => {
    // Wire-boundary parse demo. JSON.parse first (catch bad JSON), then
    // safeParseSnapshot (catch bad shape). On success, this is what
    // production code feeds into the adapter / App Group write.
    let parsed: unknown;
    try {
      parsed = JSON.parse(inboundJson);
    } catch (err) {
      setInboundResult({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const result = safeParseSnapshot(parsed);
    if (result.success) {
      setInboundResult({ kind: "ok", snapshot: result.data });
    } else {
      const message = result.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n");
      setInboundResult({ kind: "error", message });
    }
  }, [inboundJson]);

  const handleSeedFromFixture = useCallback(() => {
    // Convenience: copy a known-good liveActivity fixture into the
    // textarea so the parse path can be exercised without a backend.
    const fixture = Object.values(surfaceFixtureSnapshots).find(
      (s) => s.kind === "liveActivity",
    );
    if (!fixture) return;
    setInboundJson(JSON.stringify(fixture, null, 2));
    setInboundResult({ kind: "idle" });
  }, []);

  const tokens = tokenStore.tokens;

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.title}>Delivery example</Text>
      <Text style={styles.subtitle}>
        A food-delivery order is the reference domain. Every stage transition
        projects the order through deliveryToSnapshot, parses the result, and
        emits to every surface kind. Substitute your own domain type to build
        a real app on this skeleton.
      </Text>

      <Section label="Order">
        <Text style={styles.value}>
          {order.restaurant} — {order.itemCount} items
        </Text>
        <Text style={styles.value}>Stage: {order.stage}</Text>
        <Text style={styles.value}>
          {order.etaMinutes !== undefined
            ? `ETA: ${order.etaMinutes} min`
            : "ETA: —"}
        </Text>
        {order.driverName ? (
          <Text style={styles.value}>Driver: {order.driverName}</Text>
        ) : null}
        <Text style={styles.smallValue} selectable>
          id: {order.id} · updatedAt: {order.updatedAt}
        </Text>
      </Section>

      <Section label="Advance">
        <Row>
          {STAGE_BUTTONS.map(({ stage, label }) => (
            <Btn
              key={stage}
              label={label}
              onPress={() => transitionTo(stage)}
              disabled={busy}
            />
          ))}
          <Btn
            label="Reset"
            onPress={handleReset}
            disabled={busy}
            variant="secondary"
          />
        </Row>
        {status ? <Text style={styles.statusLine}>{status}</Text> : null}
      </Section>

      <Section label="Tokens observed">
        {tokens.length === 0 ? (
          <Text style={styles.value}>
            None yet. Push-to-start arrives via the system stream; per-activity
            tokens arrive after Start, when iOS minted one.
          </Text>
        ) : (
          tokens.map((t) => (
            <View key={t.idempotencyKey} style={styles.tokenRow}>
              <Text style={styles.value}>
                {t.kind} · {t.lifecycle}
                {t.activityId ? ` · ${t.activityId.slice(0, 8)}` : ""}
              </Text>
              <Text style={styles.token} selectable>
                {t.token}
              </Text>
            </View>
          ))
        )}
      </Section>

      <Section label="Backend payload">
        <Text style={styles.value}>
          The shape below is what your backend posts. The host runs
          JSON.parse, then safeParseSnapshot, then projects to the wire-
          shaped ContentState. Edit the payload, hit Parse, watch the
          field-path errors light up.
        </Text>
        <Row>
          <Btn
            label="Use current order"
            onPress={handleSimulateBackendPayload}
            disabled={busy}
            variant="secondary"
          />
          <Btn
            label="Use fixture"
            onPress={handleSeedFromFixture}
            disabled={busy}
            variant="secondary"
          />
        </Row>
        <TextInput
          style={styles.payloadInput}
          value={inboundJson}
          onChangeText={setInboundJson}
          multiline
          placeholder="Paste a backend JSON payload, or seed from above."
          placeholderTextColor={surfaceColors.inkSecondary}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Row>
          <Btn label="Parse" onPress={handleParseInbound} disabled={busy} />
        </Row>
        {inboundResult.kind === "ok" ? (
          <View style={styles.parseOk}>
            <Text style={styles.parseOkLabel}>
              ✓ Parsed (kind: {inboundResult.snapshot.kind})
            </Text>
            <Text style={styles.smallValue} selectable>
              id: {inboundResult.snapshot.id}
            </Text>
          </View>
        ) : inboundResult.kind === "error" ? (
          <View style={styles.parseError}>
            <Text style={styles.parseErrorLabel}>Parse failed</Text>
            <Text style={styles.parseErrorBody} selectable>
              {inboundResult.message}
            </Text>
          </View>
        ) : null}
      </Section>

      <TrapErrorCard error={error} onDismiss={() => setError(null)} />
      {busy ? <ActivityIndicator style={styles.spinner} /> : null}
    </ScrollView>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

function Btn({
  label,
  onPress,
  disabled,
  variant = "primary",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        variant === "secondary" ? styles.btnSecondary : null,
        disabled && styles.btnDisabled,
        pressed && !disabled && styles.btnPressed,
      ]}
    >
      <Text
        style={[
          styles.btnLabel,
          variant === "secondary" ? styles.btnLabelSecondary : null,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: 20,
    paddingTop: 24,
    gap: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
    color: surfaceColors.inkPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: surfaceColors.inkSecondary,
    lineHeight: 18,
  },
  section: {
    gap: 6,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: surfaceColors.inkSecondary,
    marginBottom: 4,
  },
  value: {
    fontSize: 14,
    color: surfaceColors.inkPrimary,
    lineHeight: 20,
  },
  smallValue: {
    fontSize: 11,
    fontFamily: "Menlo",
    color: surfaceColors.inkSecondary,
  },
  token: {
    fontFamily: "Menlo",
    fontSize: 11,
    color: surfaceColors.inkPrimary,
  },
  tokenRow: {
    paddingVertical: 4,
    gap: 2,
  },
  statusLine: {
    fontSize: 13,
    color: surfaceColors.success,
    marginTop: 4,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  btn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: surfaceColors.primary,
  },
  btnSecondary: {
    backgroundColor: surfaceColors.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surfaceColors.inkSecondary,
  },
  btnPressed: {
    opacity: 0.7,
  },
  btnDisabled: {
    backgroundColor: surfaceColors.disabled,
  },
  btnLabel: {
    color: surfaceColors.onPrimary,
    fontSize: 14,
    fontWeight: "500",
  },
  btnLabelSecondary: {
    color: surfaceColors.inkPrimary,
  },
  payloadInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surfaceColors.inkSecondary,
    borderRadius: 10,
    padding: 10,
    fontFamily: "Menlo",
    fontSize: 11,
    color: surfaceColors.inkPrimary,
    backgroundColor: surfaceColors.surfaceElevated,
    minHeight: 160,
    textAlignVertical: "top",
  },
  parseOk: {
    backgroundColor: surfaceColors.surfaceElevated,
    borderRadius: 8,
    padding: 10,
    gap: 4,
    borderLeftWidth: 3,
    borderLeftColor: surfaceColors.success,
  },
  parseOkLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: surfaceColors.success,
  },
  parseError: {
    backgroundColor: surfaceColors.dangerSurface,
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  parseErrorLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: surfaceColors.dangerText,
  },
  parseErrorBody: {
    fontFamily: "Menlo",
    fontSize: 11,
    color: surfaceColors.dangerText,
    lineHeight: 16,
  },
  spinner: {
    marginTop: 12,
  },
});
