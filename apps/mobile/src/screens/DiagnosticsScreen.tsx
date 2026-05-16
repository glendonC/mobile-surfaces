// Diagnostics console for Mobile Surfaces. Fixture firing range, App Group
// probes, token-store inspector, MS036 decode-error breadcrumb panel. The
// Delivery tab is the reference shape for a real app; this tab is the
// tool you reach for when something silently fails.
//
// Every button fires a canonical LiveSurfaceSnapshot from
// data/surface-fixtures/ so you can verify that each surface kind (Lock
// Screen Live Activity, Dynamic Island, home widget, control widget,
// lock accessory, StandBy) renders correctly against the bridge. The
// token store panel near the top shows every token iOS has handed the
// host this session, via @mobile-surfaces/tokens (MS020/MS021).
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { surfaceColors } from "../theme";
import { liveActivityAdapter as LiveActivity, LiveActivitySnapshot } from "../liveActivity";
import { diagnoseSupport } from "../liveActivity/diagnoseSupport";
import {
  activityFixtureStates,
  // SURFACE-BEGIN: control-widget
  controlSurfaceFixtures,
  // SURFACE-END: control-widget
  // SURFACE-BEGIN: lock-accessory-widget
  lockAccessorySurfaceFixtures,
  // SURFACE-END: lock-accessory-widget
  // SURFACE-BEGIN: standby-widget
  standbySurfaceFixtures,
  // SURFACE-END: standby-widget
  surfaceFixtures,
  // SURFACE-BEGIN: home-widget
  widgetSurfaceFixtures,
  // SURFACE-END: home-widget
} from "../fixtures/surfaceFixtures";
import {
  canRequestPushToken,
  getDeviceApnsToken,
  registerNotificationCategories,
  requestNotificationPermissions,
} from "../notifications";
// SURFACE-BEGIN: home-widget control-widget lock-accessory-widget standby-widget
import {
  // SURFACE-BEGIN: home-widget
  refreshWidgetSurface,
  // SURFACE-END: home-widget
  // SURFACE-BEGIN: control-widget
  toggleControlSurface,
  // SURFACE-END: control-widget
  // SURFACE-BEGIN: lock-accessory-widget
  refreshLockAccessorySurface,
  // SURFACE-END: lock-accessory-widget
  // SURFACE-BEGIN: standby-widget
  refreshStandbySurface,
  // SURFACE-END: standby-widget
} from "../surfaceStorage";
// SURFACE-END: home-widget control-widget lock-accessory-widget standby-widget
import { useTokenStore } from "@mobile-surfaces/tokens/react";
import { DemoModeCard } from "../components/DemoModeCard";
import { SetupStatusPanel } from "../components/SetupStatusPanel";
import { TrapErrorCard } from "../components/TrapErrorCard";

export function DiagnosticsScreen() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [active, setActive] = useState<LiveActivitySnapshot[]>([]);
  const [activityId, setActivityId] = useState<string | null>(null);
  const [apnsToken, setApnsToken] = useState<string | null>(null);

  // Token-store wiring. All three adapter events (onPushToken,
  // onPushToStartToken, onActivityStateChange) are owned by the store
  // (MS016/MS020/MS021). The screen reads `tokenStore.tokens` and
  // derives the latest push-to-start emission from there; nothing
  // calls adapter.addListener directly for token events.
  const tokenStore = useTokenStore({
    adapter: LiveActivity,
    environment: "development",
  });
  const tokens = tokenStore.tokens;
  const pushToStartToken =
    tokens.find((t) => t.kind === "pushToStart")?.token ?? null;
  const pushToken =
    activityId !== null
      ? (tokens.find(
          (t) => t.kind === "perActivity" && t.activityId === activityId,
        )?.token ?? null)
      : null;
  // SURFACE-BEGIN: home-widget control-widget lock-accessory-widget standby-widget
  const [surfaceStatus, setSurfaceStatus] = useState<string | null>(null);
  // SURFACE-END: home-widget control-widget lock-accessory-widget standby-widget
  // SURFACE-BEGIN: control-widget
  const [controlOn, setControlOn] = useState(false);
  // SURFACE-END: control-widget
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  // Bumped on adapter events that would change a setup probe outcome
  // (push-to-start token, activity start/end). Lets SetupStatusPanel rerun
  // its probes without us reaching across components.
  const [setupRefreshKey, setSetupRefreshKey] = useState(0);
  const fixtureKeys = Object.keys(activityFixtureStates) as Array<
    keyof typeof activityFixtureStates
  >;

  // Mirror activityId into a ref so listeners (registered once at mount) can
  // read the current value without re-subscribing on every change.
  const activityIdRef = useRef<string | null>(null);
  useEffect(() => {
    activityIdRef.current = activityId;
  }, [activityId]);

  const refreshActive = useCallback(async () => {
    try {
      const list = await LiveActivity.listActive();
      setActive(list);
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    LiveActivity.areActivitiesEnabled().then(setSupported).catch(() => setSupported(false));
    refreshActive();
    // Register notification categories before any APNs notification can be
    // delivered. The bundled UNNotificationContentExtension's Info.plist
    // routes on these same identifiers (codegen MS037); without this call
    // iOS still delivers the alert but the extension never fires, and the
    // host delegate has nothing to match actions against. Fire-and-forget
    // is fine: the call is idempotent and a transient permission denial
    // does not block the rest of the harness.
    registerNotificationCategories().catch((e) => {
      console.warn("registerNotificationCategories failed", e);
    });
  }, [refreshActive]);

  // Token-store-driven UI state. The store owns the three adapter
  // events (MS039); local diagnostics state derives from its snapshot.
  // On a terminal lifecycle for the current activityId, the store
  // flips its matching perActivity record to "dead" — we observe that
  // here, drop the active-list row, clear activityId, and bump the
  // setup-status panel so its probes re-run.
  useEffect(() => {
    const unsub = tokenStore.subscribe((snapshot) => {
      const currentId = activityIdRef.current;
      if (currentId !== null) {
        const liveRecord = snapshot.find(
          (t) =>
            t.kind === "perActivity" &&
            t.activityId === currentId &&
            t.lifecycle === "active",
        );
        if (!liveRecord) {
          // The store marked our activity dead/ending (or never minted
          // a token for it). Drop it from the local list when matching.
          const deadOrEnding = snapshot.find(
            (t) =>
              t.kind === "perActivity" &&
              t.activityId === currentId &&
              (t.lifecycle === "dead" || t.lifecycle === "ending"),
          );
          if (deadOrEnding) {
            setActive((prev) => prev.filter((a) => a.id !== currentId));
            setActivityId(null);
            setSetupRefreshKey((k) => k + 1);
          }
        }
      }
      // Mirror the latest perActivity token onto the local listActive
      // rows so the UI keeps showing tokens beside their activity.
      setActive((prev) =>
        prev.map((a) => {
          const match = snapshot.find(
            (t) =>
              t.kind === "perActivity" &&
              t.activityId === a.id &&
              t.lifecycle === "active",
          );
          return match ? { ...a, pushToken: match.token } : a;
        }),
      );
      setSetupRefreshKey((k) => k + 1);
    });
    return unsub;
  }, [tokenStore]);

  // Channel-push starts (iOS 18+) are exercised through scripts/send-apns.mjs,
  // not from the harness UI: channel mode is server-driven (one publish fans
  // out to N devices), so the device side just chooses pushType at start.
  const handleStart = useCallback(async (key: keyof typeof activityFixtureStates) => {
    setBusy(true);
    setError(null);
    try {
      const snapshot = surfaceFixtures[key];
      const result = await LiveActivity.start(
        snapshot.surfaceId,
        snapshot.liveActivity.modeLabel,
        activityFixtureStates[key],
      );
      setActivityId(result.id);
      setSetupRefreshKey((k) => k + 1);
      await refreshActive();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }, [refreshActive]);

  const handleUpdate = useCallback(async (key: keyof typeof activityFixtureStates) => {
    if (!activityId) return;
    setBusy(true);
    setError(null);
    try {
      await LiveActivity.update(activityId, activityFixtureStates[key]);
      await refreshActive();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }, [activityId, refreshActive]);

  const handleEnd = useCallback(async (policy: "immediate" | "default") => {
    if (!activityId) return;
    setBusy(true);
    setError(null);
    try {
      await LiveActivity.end(activityId, policy);
      setActivityId(null);
      await refreshActive();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }, [activityId, refreshActive]);

  const handleEndAll = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const list = await LiveActivity.listActive();
      await Promise.all(list.map((activity) => LiveActivity.end(activity.id, "immediate")));
      setActivityId(null);
      await refreshActive();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }, [refreshActive]);

  const handleFetchApns = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (!canRequestPushToken()) {
        setError("APNs token only available on a physical device");
        return;
      }
      const perm = await requestNotificationPermissions();
      if (perm.status !== "granted") {
        setError("Notification permission not granted");
        return;
      }
      const token = await getDeviceApnsToken();
      setApnsToken(token);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }, []);

  // SURFACE-BEGIN: home-widget
  const handleRefreshWidget = useCallback(async () => {
    const snapshot = Object.values(widgetSurfaceFixtures)[0];
    if (!snapshot) {
      setError("No widget fixture is available.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const entry = await refreshWidgetSurface(snapshot);
      setSurfaceStatus(`Widget refreshed: ${entry.headline}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }, []);
  // SURFACE-END: home-widget

  // SURFACE-BEGIN: lock-accessory-widget
  const handleRefreshLockAccessory = useCallback(async () => {
    const snapshot = Object.values(lockAccessorySurfaceFixtures)[0];
    if (!snapshot) {
      setError("No lockAccessory fixture is available.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const entry = await refreshLockAccessorySurface(snapshot);
      setSurfaceStatus(`Lock accessory refreshed: ${entry.headline}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }, []);
  // SURFACE-END: lock-accessory-widget

  // SURFACE-BEGIN: standby-widget
  const handleRefreshStandby = useCallback(async () => {
    const snapshot = Object.values(standbySurfaceFixtures)[0];
    if (!snapshot) {
      setError("No StandBy fixture is available.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const entry = await refreshStandbySurface(snapshot);
      setSurfaceStatus(`StandBy refreshed: ${entry.headline}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }, []);
  // SURFACE-END: standby-widget

  // SURFACE-BEGIN: control-widget
  const handleToggleControl = useCallback(async () => {
    const snapshot = Object.values(controlSurfaceFixtures)[0];
    if (!snapshot) {
      setError("No control fixture is available.");
      return;
    }
    const next = !controlOn;
    setBusy(true);
    setError(null);
    try {
      const entry = await toggleControlSurface(snapshot, next);
      setControlOn(next);
      setSurfaceStatus(`Control ${entry.value ? "on" : "off"}: ${entry.label}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }, [controlOn]);
  // SURFACE-END: control-widget

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.title}>Diagnostics</Text>
      <DemoModeCard />
      <SetupStatusPanel
        pushToStartToken={pushToStartToken}
        activeActivityId={activityId}
        refreshKey={setupRefreshKey}
      />
      <Text style={styles.subtitle}>
        Fire fixtures, probe the App Group, watch the token store. The
        Delivery tab next door is the reference shape for a real app.
      </Text>

      <Section label="Tokens observed">
        {tokens.length === 0 ? (
          <Text style={styles.value}>
            None yet. Push-to-start arrives via the system stream; per-
            activity tokens arrive after Start when iOS minted one.
          </Text>
        ) : (
          tokens.map((t) => (
            <View key={t.idempotencyKey} style={styles.tokenStoreRow}>
              <Text style={styles.value}>
                {t.kind} · {t.lifecycle}
                {t.activityId ? ` · ${t.activityId.slice(0, 8)}` : ""} ·{" "}
                {t.environment}
              </Text>
              <Text style={styles.token} selectable>
                {t.token}
              </Text>
            </View>
          ))
        )}
      </Section>

      <Section label="Activities supported">
        <Text style={styles.value}>
          {supported === null ? "checking…" : supported ? "yes" : diagnoseSupport()}
        </Text>
      </Section>

      <Section label="Start">
        <Row>
          {fixtureKeys.map((key) => (
            <Btn
              key={`start-${String(key)}`}
              label={surfaceFixtures[key].liveActivity.modeLabel}
              onPress={() => handleStart(key)}
              disabled={busy}
            />
          ))}
        </Row>
      </Section>

      <Section label="Update current">
        <Row>
          {fixtureKeys.map((key) => (
            <Btn
              key={`update-${String(key)}`}
              label={`→ ${surfaceFixtures[key].liveActivity.modeLabel}`}
              onPress={() => handleUpdate(key)}
              disabled={busy || !activityId}
            />
          ))}
        </Row>
      </Section>

      <Section label="End current">
        <Row>
          <Btn label="default" onPress={() => handleEnd("default")} disabled={busy || !activityId} />
          <Btn label="immediate" onPress={() => handleEnd("immediate")} disabled={busy || !activityId} />
          <Btn label="all active" onPress={handleEndAll} disabled={busy || active.length === 0} />
        </Row>
      </Section>

      <Section label="Current activity">
        <Text style={styles.value} selectable>
          id: {activityId ?? "—"}
        </Text>
        <Text style={styles.value} selectable>
          push token: {pushToken ?? "(arrives async; long-press to copy)"}
        </Text>
      </Section>

      <Section label="Push-to-start token">
        <Text style={styles.value} selectable>
          {pushToStartToken ?? "(iOS 17.2+; arrives via system stream — long-press to copy)"}
        </Text>
      </Section>

      <Section label="All active activities">
        {active.length === 0 ? (
          <Text style={styles.value}>none</Text>
        ) : (
          active.map((a) => (
            <View key={a.id} style={styles.activityRow}>
              <Text style={styles.value} selectable>
                {a.id} — {a.modeLabel} — {Math.round(a.state.progress * 100)}% — {a.state.stage}
              </Text>
              {a.pushToken ? (
                <Text style={styles.token} selectable>{a.pushToken}</Text>
              ) : null}
            </View>
          ))
        )}
        <Btn label="refresh" onPress={refreshActive} disabled={busy} />
      </Section>

      {/* SURFACE-BEGIN: home-widget */}
      <Section label="Home widget">
        <Text style={styles.value}>
          Writes the widget fixture into the App Group and reloads the timeline.
        </Text>
        <Btn label="refresh widget" onPress={handleRefreshWidget} disabled={busy} />
      </Section>
      {/* SURFACE-END: home-widget */}

      {/* SURFACE-BEGIN: control-widget */}
      <Section label="Control widget">
        <Text style={styles.value}>
          Writes the control fixture into the App Group and reloads iOS 18 controls.
        </Text>
        <Btn
          label={`toggle control ${controlOn ? "off" : "on"}`}
          onPress={handleToggleControl}
          disabled={busy}
        />
      </Section>
      {/* SURFACE-END: control-widget */}

      {/* SURFACE-BEGIN: lock-accessory-widget */}
      <Section label="Lock Screen accessory">
        <Text style={styles.value}>
          Writes the lockAccessory fixture into the App Group and reloads the
          accessory family widget.
        </Text>
        <Btn
          label="refresh lock accessory"
          onPress={handleRefreshLockAccessory}
          disabled={busy}
        />
      </Section>
      {/* SURFACE-END: lock-accessory-widget */}

      {/* SURFACE-BEGIN: standby-widget */}
      <Section label="StandBy">
        <Text style={styles.value}>
          Writes the StandBy fixture into the App Group and reloads the night-mode
          surface.
        </Text>
        <Btn
          label="refresh StandBy"
          onPress={handleRefreshStandby}
          disabled={busy}
        />
      </Section>
      {/* SURFACE-END: standby-widget */}

      {/* SURFACE-BEGIN: home-widget control-widget lock-accessory-widget standby-widget */}
      {surfaceStatus ? (
        <Section label="Widget/control status">
          <Text style={styles.value}>{surfaceStatus}</Text>
        </Section>
      ) : null}
      {/* SURFACE-END: home-widget control-widget lock-accessory-widget standby-widget */}

      <Section label="APNs device token (for regular alerts)">
        <Text style={styles.value} selectable>
          {apnsToken ?? "tap fetch"}
        </Text>
        <Btn label="fetch APNs token" onPress={handleFetchApns} disabled={busy} />
      </Section>

      <TrapErrorCard error={error} onDismiss={() => setError(null)} />
      {busy ? <ActivityIndicator style={styles.spinner} /> : null}
    </ScrollView>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
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

function Btn({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        disabled && styles.btnDisabled,
        pressed && !disabled && styles.btnPressed,
      ]}
    >
      <Text style={styles.btnLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: 20,
    paddingTop: 64,
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
    marginBottom: 8,
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
  token: {
    fontFamily: "Menlo",
    fontSize: 11,
    color: surfaceColors.inkPrimary,
    marginTop: 2,
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
  activityRow: {
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: surfaceColors.surface,
  },
  tokenStoreRow: {
    paddingVertical: 4,
    gap: 2,
  },
  spinner: {
    marginTop: 12,
  },
});
