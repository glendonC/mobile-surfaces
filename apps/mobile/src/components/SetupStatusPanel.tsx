// Always-visible panel at the top of the harness summarizing setup state.
// Each row shows a single setup probe (iOS version, runtime context, Live
// Activities authorization, App Group writability, push-to-start token,
// active activity). Failed/warning rows tap-expand into the catalog entry
// the trapId points to so the next step is always one tap away.
//
// Designed to be a single deletable component. Removing the import + the
// <SetupStatusPanel /> render in LiveActivityHarness.tsx is a 2-line edit.

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { surfaceColors } from "@mobile-surfaces/design-tokens";
import type { DiagnosticCheck } from "@mobile-surfaces/surface-contracts";
import { runSetupProbes } from "../diagnostics/checkSetup";
import { SetupStatusRow } from "./SetupStatusRow";

export interface SetupStatusPanelProps {
  pushToStartToken: string | null;
  activeActivityId: string | null;
  /** Bumping this triggers a probe re-run (e.g. after a relevant adapter event). */
  refreshKey?: number;
}

export function SetupStatusPanel({
  pushToStartToken,
  activeActivityId,
  refreshKey = 0,
}: SetupStatusPanelProps) {
  const [checks, setChecks] = useState<DiagnosticCheck[] | null>(null);
  const [busy, setBusy] = useState(false);

  const probe = useCallback(async () => {
    setBusy(true);
    try {
      const next = await runSetupProbes({
        pushToStartToken,
        activeActivityId,
      });
      setChecks(next);
    } finally {
      setBusy(false);
    }
  }, [pushToStartToken, activeActivityId]);

  useEffect(() => {
    void probe();
  }, [probe, refreshKey]);

  const summary = summarize(checks);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Setup status</Text>
        <View style={styles.headerRight}>
          {busy ? (
            <ActivityIndicator size="small" color={surfaceColors.inkSecondary} />
          ) : (
            <Text style={[styles.summary, summaryColor(summary.kind)]}>
              {summary.label}
            </Text>
          )}
        </View>
      </View>
      {checks?.map((check) => (
        <SetupStatusRow key={check.id} check={check} />
      ))}
    </View>
  );
}

function summarize(checks: DiagnosticCheck[] | null): {
  label: string;
  kind: "ok" | "warn" | "fail" | "loading";
} {
  if (!checks) return { label: "Probing…", kind: "loading" };
  const fails = checks.filter((c) => c.status === "fail").length;
  if (fails > 0) return { label: `${fails} failing`, kind: "fail" };
  const warns = checks.filter((c) => c.status === "warn").length;
  if (warns > 0) return { label: `${warns} warning`, kind: "warn" };
  return { label: "All systems go", kind: "ok" };
}

function summaryColor(kind: "ok" | "warn" | "fail" | "loading") {
  switch (kind) {
    case "ok":
      return { color: surfaceColors.success };
    case "warn":
      return { color: surfaceColors.warning };
    case "fail":
      return { color: surfaceColors.dangerText };
    default:
      return { color: surfaceColors.inkSecondary };
  }
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: surfaceColors.surfaceElevated,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    gap: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 6,
    marginBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: surfaceColors.surface,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    color: surfaceColors.inkPrimary,
  },
  summary: {
    fontSize: 13,
    fontWeight: "500",
  },
});
