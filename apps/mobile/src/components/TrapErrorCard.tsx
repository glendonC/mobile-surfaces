// Renders a caught error with the matching trap catalog entry inline. When
// the error has a `trapId` field (every typed error from @mobile-surfaces/push
// does, plus app-side errors that opt in), the card surfaces the catalog
// title, symptom, and fix instead of just the error message. Otherwise it
// renders the raw message and prompts the user to run `pnpm surface:diagnose`.
//
// Replaces the inline `<Text>{error}</Text>` rendering in
// LiveActivityHarness.tsx; deletion is a 2-line edit (drop the import + the
// element).

import { Pressable, StyleSheet, Text, View } from "react-native";
import { surfaceColors } from "@mobile-surfaces/design-tokens";
import {
  findTrap,
  findTrapByErrorClass,
} from "@mobile-surfaces/surface-contracts";

export interface TrapErrorCardProps {
  /** The caught error. Accepts unknown for the same reason caller code does. */
  error: unknown;
  /** Optional dismiss handler; renders a clear button when provided. */
  onDismiss?: () => void;
}

export function TrapErrorCard({ error, onDismiss }: TrapErrorCardProps) {
  if (error === null || error === undefined) return null;

  const message = extractMessage(error);
  const trap = resolveTrap(error);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.icon}>✗</Text>
        <Text style={styles.title}>
          {trap ? trap.title : "Something failed"}
        </Text>
        {trap ? <Text style={styles.trapTag}>{trap.id}</Text> : null}
      </View>
      <Text style={styles.message}>{message}</Text>
      {trap ? (
        <View style={styles.detail}>
          <Text style={styles.detailLabel}>Fix</Text>
          <Text style={styles.detailBody}>{trap.fix}</Text>
        </View>
      ) : (
        <View style={styles.detail}>
          <Text style={styles.detailLabel}>Need help?</Text>
          <Text style={styles.detailBody}>
            Run <Text style={styles.code}>pnpm surface:diagnose</Text> from the
            repo root and attach the generated .md file to a GitHub issue. The
            output is safe to paste publicly.
          </Text>
        </View>
      )}
      {onDismiss ? (
        <Pressable
          onPress={onDismiss}
          style={({ pressed }) => [
            styles.dismiss,
            pressed ? styles.dismissPressed : null,
          ]}
        >
          <Text style={styles.dismissLabel}>Dismiss</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function resolveTrap(error: unknown) {
  // First: explicit trapId field (push SDK errors and app-side errors that
  // opt in by exposing one).
  const trapId = (error as { trapId?: unknown })?.trapId;
  if (typeof trapId === "string") {
    const byId = findTrap(trapId);
    if (byId) return byId;
  }
  // Second: error class name (also works for SurfaceStorageError etc. once
  // they're cited in data/traps.json).
  if (error instanceof Error) {
    const byClass = findTrapByErrorClass(error.name);
    if (byClass) return byClass;
  }
  return undefined;
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: surfaceColors.dangerSurface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    gap: 6,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  icon: {
    fontSize: 14,
    color: surfaceColors.dangerText,
    width: 18,
    textAlign: "center",
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: surfaceColors.dangerText,
  },
  trapTag: {
    fontSize: 11,
    fontWeight: "600",
    color: surfaceColors.dangerText,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: surfaceColors.surface,
  },
  message: {
    fontSize: 13,
    color: surfaceColors.dangerText,
    lineHeight: 18,
  },
  detail: {
    marginTop: 4,
    gap: 2,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: surfaceColors.dangerText,
    opacity: 0.8,
  },
  detailBody: {
    fontSize: 12,
    color: surfaceColors.dangerText,
    lineHeight: 16,
  },
  code: {
    fontFamily: "Menlo",
    fontSize: 11,
  },
  dismiss: {
    alignSelf: "flex-end",
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 4,
  },
  dismissPressed: {
    opacity: 0.6,
  },
  dismissLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: surfaceColors.dangerText,
  },
});
