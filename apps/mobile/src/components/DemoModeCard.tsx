// First-launch signpost for the harness. Two concrete steps a user can
// take right now without configuring APNs, plus a footer that names the
// alarming-looking warning row in SetupStatusPanel as expected for local
// testing. Sits at the very top of the harness so it's the first thing
// the user reads after the title.
//
// Single deletable component: removing the import + the <DemoModeCard />
// element from LiveActivityHarness.tsx is a 2-line edit.

import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { surfaceColors } from "@mobile-surfaces/design-tokens";

export interface DemoModeCardProps {
  /** Optional external dismiss handler. The card also self-dismisses for
   * the lifetime of the screen via internal state. */
  onDismiss?: () => void;
}

export function DemoModeCard({ onDismiss }: DemoModeCardProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Try it now</Text>
        <Pressable
          onPress={handleDismiss}
          style={({ pressed }) => [
            styles.dismiss,
            pressed ? styles.dismissPressed : null,
          ]}
        >
          <Text style={styles.dismissLabel}>Got it</Text>
        </Pressable>
      </View>
      <View style={styles.steps}>
        <Step n={1}>Tap a Start button below.</Step>
        <Step n={2}>
          Lock the simulator (⌘L) to see your Live Activity on the Lock Screen.
        </Step>
      </View>
      <Text style={styles.note}>
        These buttons work without any APNs setup. Push-to-start tokens are
        optional for local testing.
      </Text>
    </View>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNumber}>
        <Text style={styles.stepNumberLabel}>{n}</Text>
      </View>
      <Text style={styles.stepBody}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: surfaceColors.surfaceElevated,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    gap: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    color: surfaceColors.inkPrimary,
  },
  dismiss: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  dismissPressed: {
    opacity: 0.6,
  },
  dismissLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: surfaceColors.inkSecondary,
  },
  steps: {
    gap: 8,
  },
  step: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  stepNumber: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: surfaceColors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  stepNumberLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: surfaceColors.onPrimary,
  },
  stepBody: {
    flex: 1,
    fontSize: 13,
    color: surfaceColors.inkPrimary,
    lineHeight: 18,
  },
  note: {
    fontSize: 12,
    color: surfaceColors.inkSecondary,
    lineHeight: 16,
  },
});
