import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Application from "expo-application";
import { surfaceColors } from "@mobile-surfaces/design-tokens";
import { liveActivityAdapter as LiveActivity, LiveActivitySnapshot } from "../liveActivity";

const appName = Application.applicationName ?? "this app";
const activitiesUnsupportedHint = `no (toggle in iOS Settings → Face ID & Passcode → Allow Notifications, or Settings → ${appName} → Live Activities)`;
import { activityFixtureStates, surfaceFixtures } from "../fixtures/surfaceFixtures";
import {
  canRequestPushToken,
  getDeviceApnsToken,
  requestNotificationPermissions,
} from "../notifications";

export function LiveActivityHarness() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [active, setActive] = useState<LiveActivitySnapshot[]>([]);
  const [activityId, setActivityId] = useState<string | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [apnsToken, setApnsToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      setError(formatError(e));
    }
  }, []);

  useEffect(() => {
    LiveActivity.areActivitiesEnabled().then(setSupported).catch(() => setSupported(false));
    refreshActive();

    const tokenSub = LiveActivity.addListener("onPushToken", ({ activityId: id, token }) => {
      if (id === activityIdRef.current) {
        setPushToken(token);
      }
      setActive((prev) =>
        prev.map((a) => (a.id === id ? { ...a, pushToken: token } : a)),
      );
    });
    const stateSub = LiveActivity.addListener("onActivityStateChange", ({ activityId: id, state }) => {
      if (state === "ended" || state === "dismissed") {
        setActive((prev) => prev.filter((a) => a.id !== id));
        if (activityIdRef.current === id) {
          setActivityId(null);
          setPushToken(null);
        }
      }
    });

    return () => {
      tokenSub.remove();
      stateSub.remove();
    };
  }, [refreshActive]);

  const handleStart = useCallback(async (key: keyof typeof activityFixtureStates) => {
    setBusy(true);
    setError(null);
    try {
      const snapshot = surfaceFixtures[key];
      const result = await LiveActivity.start(
        snapshot.surfaceId,
        snapshot.modeLabel,
        activityFixtureStates[key],
      );
      setActivityId(result.id);
      setPushToken(null);
      await refreshActive();
    } catch (e) {
      setError(formatError(e));
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
      setError(formatError(e));
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
      setPushToken(null);
      await refreshActive();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  }, [activityId, refreshActive]);

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
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.title}>Surface Harness</Text>
      <Text style={styles.subtitle}>
        Start, update, end, and push-test generic Live Activity snapshots.
      </Text>

      <Section label="Activities supported">
        <Text style={styles.value}>
          {supported === null ? "checking…" : supported ? "yes" : activitiesUnsupportedHint}
        </Text>
      </Section>

      <Section label="Start">
        <Row>
          {fixtureKeys.map((key) => (
            <Btn
              key={`start-${String(key)}`}
              label={surfaceFixtures[key].modeLabel}
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
              label={`→ ${surfaceFixtures[key].modeLabel}`}
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

      <Section label="APNs device token (for regular alerts)">
        <Text style={styles.value} selectable>
          {apnsToken ?? "tap fetch"}
        </Text>
        <Btn label="fetch APNs token" onPress={handleFetchApns} disabled={busy} />
      </Section>

      {error ? (
        <View style={styles.error}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
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

function formatError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return JSON.stringify(e);
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
  error: {
    padding: 12,
    backgroundColor: surfaceColors.dangerSurface,
    borderRadius: 10,
  },
  errorText: {
    color: surfaceColors.dangerText,
    fontSize: 13,
  },
  spinner: {
    marginTop: 12,
  },
});
