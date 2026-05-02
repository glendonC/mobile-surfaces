// One row in the SetupStatusPanel. Tap to expand: shows the catalog entry
// that the row's trapId points at (title, severity, fix), so the next step
// is always one tap away from the failing row. If the row has no trapId,
// the detail.message is shown verbatim.

import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { surfaceColors } from "@mobile-surfaces/design-tokens";
import {
  findTrap,
  type DiagnosticCheck,
} from "@mobile-surfaces/surface-contracts";

export interface SetupStatusRowProps {
  check: DiagnosticCheck;
}

export function SetupStatusRow({ check }: SetupStatusRowProps) {
  const [expanded, setExpanded] = useState(false);
  const trap = check.trapId ? findTrap(check.trapId) : undefined;
  const expandable =
    trap !== undefined ||
    !!check.detail?.message ||
    !!check.detail?.issues?.length;

  return (
    <Pressable
      onPress={() => expandable && setExpanded((v) => !v)}
      style={({ pressed }) => [
        styles.row,
        pressed && expandable ? styles.pressed : null,
      ]}
    >
      <View style={styles.rowHeader}>
        <Text style={styles.icon}>{iconFor(check.status)}</Text>
        <Text style={styles.summary}>{check.summary}</Text>
        {check.trapId ? (
          <Text style={styles.trapTag}>{check.trapId}</Text>
        ) : null}
      </View>
      {expanded ? (
        <View style={styles.detail}>
          {trap ? (
            <>
              <Text style={styles.detailTitle}>{trap.title}</Text>
              <Text style={styles.detailLabel}>Symptom</Text>
              <Text style={styles.detailBody}>{trap.symptom}</Text>
              <Text style={styles.detailLabel}>Fix</Text>
              <Text style={styles.detailBody}>{trap.fix}</Text>
            </>
          ) : null}
          {check.detail?.message ? (
            <Text style={styles.detailBody}>{check.detail.message}</Text>
          ) : null}
          {check.detail?.issues?.length ? (
            <View style={styles.issueList}>
              {check.detail.issues.map((issue, idx) => (
                <Text key={idx} style={styles.issueItem}>
                  • {issue.path ? `${issue.path}: ` : ""}
                  {issue.message}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function iconFor(status: DiagnosticCheck["status"]): string {
  switch (status) {
    case "ok":
      return "✓";
    case "warn":
      return "⚠";
    case "fail":
      return "✗";
    case "skip":
    default:
      return "•";
  }
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: 6,
  },
  pressed: {
    opacity: 0.7,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  icon: {
    fontSize: 14,
    width: 18,
    textAlign: "center",
    color: surfaceColors.inkPrimary,
  },
  summary: {
    flex: 1,
    fontSize: 13,
    color: surfaceColors.inkPrimary,
  },
  trapTag: {
    fontSize: 11,
    fontWeight: "600",
    color: surfaceColors.accent,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: surfaceColors.surface,
  },
  detail: {
    marginTop: 8,
    paddingLeft: 26,
    gap: 4,
  },
  detailTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: surfaceColors.inkPrimary,
    marginBottom: 4,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: surfaceColors.inkSecondary,
    marginTop: 4,
  },
  detailBody: {
    fontSize: 12,
    color: surfaceColors.inkSecondary,
    lineHeight: 16,
  },
  issueList: {
    marginTop: 4,
    gap: 2,
  },
  issueItem: {
    fontSize: 12,
    color: surfaceColors.inkSecondary,
  },
});
