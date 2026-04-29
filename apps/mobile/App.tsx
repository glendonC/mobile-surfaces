import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaView, StyleSheet } from "react-native";
import { surfaceColors } from "@mobile-surfaces/design-tokens";
import { LiveActivityHarness } from "./src/screens/LiveActivityHarness";
import { registerBackgroundNotificationTask } from "./src/notifications";

export default function App() {
  useEffect(() => {
    registerBackgroundNotificationTask().catch((error) => {
      console.warn("Notification background task registration failed", error);
    });
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" backgroundColor={surfaceColors.surface} />
      <LiveActivityHarness />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: surfaceColors.surface,
  },
});
