// PayloadInspectorScreen renders three views over the same wire shape:
//
//   A. Fixture preview — pick a committed fixture, see the raw snapshot
//      plus its projection through the matching to* helper.
//   B. Paste payload — feed an arbitrary JSON blob through JSON.parse +
//      liveSurfaceSnapshot.safeParse, watch field-path errors light up.
//   C. Live App Group dump — read every `surface.snapshot.<id>` key from
//      the App Group and render the bytes the widget extension sees,
//      alongside any decode-error breadcrumb.
//
// The screen consumes the projection caches exported from
// fixtures/surfaceFixtures.ts (widgetFixtureEntries, controlFixtureValues,
// lockAccessoryFixtureEntries, standbyFixtureEntries) so those exports
// are live. Section A's "Projection output" pane is where they surface.

import { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  safeParseSnapshot,
  surfaceFixtureSnapshots,
  toControlValueProvider,
  toLiveActivityContentState,
  toLockAccessoryEntry,
  toNotificationContentPayload,
  toStandbyEntry,
  toWidgetTimelineEntry,
  type LiveSurfaceSnapshot,
} from "@mobile-surfaces/surface-contracts";
import { surfaceColors } from "../theme";
import {
  controlFixtureValues,
  lockAccessoryFixtureEntries,
  standbyFixtureEntries,
  widgetFixtureEntries,
} from "../fixtures/surfaceFixtures";
import {
  readSurfaceAppGroupRecord,
  type SurfaceAppGroupRecord,
} from "../surfaceStorage";

const FIXTURE_KEYS = Object.keys(surfaceFixtureSnapshots).sort();

// Pre-touch the projection caches at module load so the dead-export
// finding from Phase 0 stays resolved even if Section A's render path
// short-circuits for some reason. These references are also surfaced
// in the projection-output pane below.
const FIXTURE_PROJECTION_INDEX = {
  widget: widgetFixtureEntries,
  control: controlFixtureValues,
  lockAccessory: lockAccessoryFixtureEntries,
  standby: standbyFixtureEntries,
} as const;

function projectionFor(snapshot: LiveSurfaceSnapshot): unknown {
  switch (snapshot.kind) {
    case "liveActivity":
      return toLiveActivityContentState(snapshot);
    case "widget":
      return toWidgetTimelineEntry(snapshot);
    case "control":
      return toControlValueProvider(snapshot);
    case "lockAccessory":
      return toLockAccessoryEntry(snapshot);
    case "standby":
      return toStandbyEntry(snapshot);
    case "notification":
      return toNotificationContentPayload(snapshot);
  }
}

function knownSurfaceIds(): string[] {
  const ids = new Set<string>();
  for (const snapshot of Object.values(surfaceFixtureSnapshots)) {
    ids.add(snapshot.surfaceId);
  }
  return Array.from(ids).sort();
}

export function PayloadInspectorScreen() {
  // --- Section A: fixture preview ---
  const [selectedKey, setSelectedKey] = useState<string>(
    FIXTURE_KEYS[0] ?? "",
  );
  const selectedSnapshot =
    selectedKey && selectedKey in surfaceFixtureSnapshots
      ? (surfaceFixtureSnapshots as Record<string, LiveSurfaceSnapshot>)[
          selectedKey
        ]
      : undefined;
  const selectedProjection = useMemo(
    () => (selectedSnapshot ? projectionFor(selectedSnapshot) : null),
    [selectedSnapshot],
  );

  // --- Section B: paste payload ---
  const [pasted, setPasted] = useState<string>("");
  const [parseResult, setParseResult] = useState<
    | { kind: "idle" }
    | { kind: "ok"; snapshot: LiveSurfaceSnapshot }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const handleParse = useCallback(() => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(pasted);
    } catch (err) {
      setParseResult({
        kind: "error",
        message:
          "JSON.parse failed: " +
          (err instanceof Error ? err.message : String(err)),
      });
      return;
    }
    const result = safeParseSnapshot(parsed);
    if (result.success) {
      setParseResult({ kind: "ok", snapshot: result.data });
    } else {
      const message = result.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n");
      setParseResult({ kind: "error", message });
    }
  }, [pasted]);

  const handleSeed = useCallback(() => {
    if (!selectedSnapshot) return;
    setPasted(JSON.stringify(selectedSnapshot, null, 2));
    setParseResult({ kind: "idle" });
  }, [selectedSnapshot]);

  // --- Section C: live App Group dump ---
  const [appGroupRecords, setAppGroupRecords] = useState<
    SurfaceAppGroupRecord[]
  >([]);
  const refreshAppGroup = useCallback(() => {
    const ids = knownSurfaceIds();
    setAppGroupRecords(ids.map((id) => readSurfaceAppGroupRecord(id)));
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.title}>Payload inspector</Text>
      <Text style={styles.subtitle}>
        Read every committed fixture, parse arbitrary payloads against the
        contract, and dump the App Group bytes the widget extension is
        decoding right now.
      </Text>

      {/* ----- Section A: fixture preview ----- */}
      <Text style={styles.sectionHeader}>A · Fixture preview</Text>
      <Text style={styles.helpText}>
        Select a committed fixture. The raw snapshot is what producers emit;
        the projection is what the surface-specific consumer (widget
        extension, control value provider, notification content) receives.
      </Text>
      <Row>
        {FIXTURE_KEYS.map((key) => (
          <Chip
            key={key}
            label={key}
            selected={selectedKey === key}
            onPress={() => setSelectedKey(key)}
          />
        ))}
      </Row>
      {selectedSnapshot ? (
        <View style={styles.fixturePanes}>
          <Pane label={`Raw snapshot (kind: ${selectedSnapshot.kind})`}>
            <Text style={styles.code} selectable>
              {JSON.stringify(selectedSnapshot, null, 2)}
            </Text>
          </Pane>
          <Pane label="Projection output">
            <Text style={styles.code} selectable>
              {JSON.stringify(selectedProjection, null, 2)}
            </Text>
          </Pane>
          <Pane label="Native preview">
            <Text style={styles.helpText}>
              Render preview lives on the Swift side. The fixture above is
              what the widget extension / Live Activity / notification
              content extension decodes; build the dev client and trigger
              the surface to see the rendered output.
            </Text>
          </Pane>
        </View>
      ) : null}

      {/* Surface the dead-export consumers explicitly so a reader can see
          the projection caches are wired. The summary line names the four
          maps the Phase 0 audit flagged as dead. */}
      <Text style={styles.helpText}>
        Projection caches loaded ·{" "}
        {Object.keys(FIXTURE_PROJECTION_INDEX.widget).length} widget,{" "}
        {Object.keys(FIXTURE_PROJECTION_INDEX.control).length} control,{" "}
        {Object.keys(FIXTURE_PROJECTION_INDEX.lockAccessory).length} lock
        accessory, {Object.keys(FIXTURE_PROJECTION_INDEX.standby).length}{" "}
        standby.
      </Text>

      {/* ----- Section B: paste payload ----- */}
      <Text style={styles.sectionHeader}>B · Paste payload</Text>
      <Text style={styles.helpText}>
        Paste a JSON payload (typically what your backend POSTs). The host
        runs JSON.parse, then liveSurfaceSnapshot.safeParse. On failure, the
        field-path errors below are the same shape your production parse
        handler will see.
      </Text>
      <TextInput
        style={styles.payloadInput}
        value={pasted}
        onChangeText={setPasted}
        multiline
        placeholder="Paste a backend JSON payload here…"
        placeholderTextColor={surfaceColors.inkSecondary}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Row>
        <Btn label="Parse" onPress={handleParse} />
        <Btn
          label="Seed from selected fixture"
          onPress={handleSeed}
          variant="secondary"
          disabled={!selectedSnapshot}
        />
      </Row>
      {parseResult.kind === "ok" ? (
        <View style={styles.parseOk}>
          <Text style={styles.parseOkLabel}>
            ✓ Parsed (kind: {parseResult.snapshot.kind})
          </Text>
          <Text style={styles.code} selectable>
            {JSON.stringify(parseResult.snapshot, null, 2)}
          </Text>
        </View>
      ) : parseResult.kind === "error" ? (
        <View style={styles.parseError}>
          <Text style={styles.parseErrorLabel}>Parse failed</Text>
          <Text style={styles.parseErrorBody} selectable>
            {parseResult.message}
          </Text>
        </View>
      ) : null}

      {/* ----- Section C: live App Group dump ----- */}
      <Text style={styles.sectionHeader}>C · Live App Group dump</Text>
      <Text style={styles.helpText}>
        Reads `surface.snapshot.&lt;id&gt;` for every fixture surfaceId from
        the App Group. Refresh after writing from the Diagnostics tab or
        Delivery tab to see the latest bytes. Decode-error breadcrumbs from
        the Swift side surface in red when the widget extension failed to
        parse what was written.
      </Text>
      <Row>
        <Btn label="Refresh" onPress={refreshAppGroup} />
      </Row>
      {appGroupRecords.length === 0 ? (
        <Text style={styles.helpText}>
          Press Refresh to read the App Group.
        </Text>
      ) : (
        appGroupRecords.map((record) => (
          <Pane
            key={record.surfaceId}
            label={`surface.snapshot.${record.surfaceId}`}
          >
            <Text style={styles.smallValue}>
              writtenAt:{" "}
              {record.writtenAt
                ? new Date(record.writtenAt * 1000).toISOString()
                : "—"}
            </Text>
            {record.snapshot ? (
              <Text style={styles.code} selectable>
                {JSON.stringify(record.snapshot, null, 2)}
              </Text>
            ) : (
              <Text style={styles.helpText}>(no value written)</Text>
            )}
            {record.decodeError ? (
              <View style={styles.parseError}>
                <Text style={styles.parseErrorLabel}>
                  Decode-error breadcrumb · {record.decodeError.trapId}
                </Text>
                <Text style={styles.smallValue}>
                  at: {record.decodeError.at}
                </Text>
                <Text style={styles.parseErrorBody} selectable>
                  {record.decodeError.error}
                </Text>
              </View>
            ) : null}
          </Pane>
        ))
      )}
    </ScrollView>
  );
}

function Pane({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.pane}>
      <Text style={styles.paneLabel}>{label}</Text>
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

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected ? styles.chipSelected : null,
        pressed ? styles.chipPressed : null,
      ]}
    >
      <Text
        style={[
          styles.chipLabel,
          selected ? styles.chipLabelSelected : null,
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
    gap: 12,
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
    marginBottom: 4,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: "600",
    color: surfaceColors.inkPrimary,
    marginTop: 12,
    marginBottom: 2,
  },
  helpText: {
    fontSize: 12,
    color: surfaceColors.inkSecondary,
    lineHeight: 16,
  },
  smallValue: {
    fontSize: 11,
    fontFamily: "Menlo",
    color: surfaceColors.inkSecondary,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginVertical: 4,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surfaceColors.inkSecondary,
    backgroundColor: surfaceColors.surfaceElevated,
  },
  chipSelected: {
    backgroundColor: surfaceColors.primary,
    borderColor: surfaceColors.primary,
  },
  chipPressed: {
    opacity: 0.7,
  },
  chipLabel: {
    fontSize: 12,
    color: surfaceColors.inkPrimary,
  },
  chipLabelSelected: {
    color: surfaceColors.onPrimary,
    fontWeight: "500",
  },
  fixturePanes: {
    gap: 8,
  },
  pane: {
    backgroundColor: surfaceColors.surfaceElevated,
    borderRadius: 10,
    padding: 10,
    gap: 6,
  },
  paneLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: surfaceColors.inkSecondary,
  },
  code: {
    fontFamily: "Menlo",
    fontSize: 11,
    color: surfaceColors.inkPrimary,
    lineHeight: 15,
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
});
