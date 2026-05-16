// Three-tab navigation across Delivery (reference shape for a real app),
// Diagnostics (fixture firing range + App Group probes + token-store
// inspector), and Payload Inspector (fixture preview, paste-payload
// parse playground, live App Group dump). Implemented as a segmented
// state machine rather than pulling in a navigation library: three
// surfaces is a count where a router would be more overhead than the
// thing it routes.

import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import {
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { surfaceColors } from "./src/theme";
import { DeliveryExampleScreen } from "./src/screens/DeliveryExampleScreen";
import { DiagnosticsScreen } from "./src/screens/DiagnosticsScreen";
import { PayloadInspectorScreen } from "./src/screens/PayloadInspectorScreen";
import { registerBackgroundNotificationTask } from "./src/notifications";

type Tab = "delivery" | "diagnostics" | "inspector";

export default function App() {
  const [tab, setTab] = useState<Tab>("delivery");

  useEffect(() => {
    registerBackgroundNotificationTask().catch((error) => {
      console.warn("Notification background task registration failed", error);
    });
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" backgroundColor={surfaceColors.surface} />
      <View style={styles.tabBar}>
        <TabButton
          label="Delivery"
          active={tab === "delivery"}
          onPress={() => setTab("delivery")}
        />
        <TabButton
          label="Diagnostics"
          active={tab === "diagnostics"}
          onPress={() => setTab("diagnostics")}
        />
        <TabButton
          label="Inspector"
          active={tab === "inspector"}
          onPress={() => setTab("inspector")}
        />
      </View>
      <View style={styles.body}>
        {tab === "delivery" ? <DeliveryExampleScreen /> : null}
        {tab === "diagnostics" ? <DiagnosticsScreen /> : null}
        {tab === "inspector" ? <PayloadInspectorScreen /> : null}
      </View>
    </SafeAreaView>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tab,
        active ? styles.tabActive : null,
        pressed && !active ? styles.tabPressed : null,
      ]}
    >
      <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: surfaceColors.surface,
  },
  tabBar: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    backgroundColor: surfaceColors.surfaceElevated,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: surfaceColors.disabled,
  },
  body: {
    flex: 1,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  tabActive: {
    backgroundColor: surfaceColors.primary,
  },
  tabPressed: {
    opacity: 0.6,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: surfaceColors.inkSecondary,
  },
  tabLabelActive: {
    color: surfaceColors.onPrimary,
  },
});
