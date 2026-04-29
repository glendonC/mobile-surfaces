import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

const BACKGROUND_NOTIFICATION_TASK = "MOBILE_SURFACES_BACKGROUND_NOTIFICATION";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

TaskManager.defineTask(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn("Background notification task failed", error);
    return;
  }
  console.log("Background notification received", data);
});

export async function registerBackgroundNotificationTask() {
  const registered = await TaskManager.getRegisteredTasksAsync();
  const isRegistered = registered.some(
    (task) => task.taskName === BACKGROUND_NOTIFICATION_TASK,
  );
  if (!isRegistered) {
    await Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK);
  }
}

export async function getNotificationPermissionStatus() {
  return Notifications.getPermissionsAsync();
}

export async function requestNotificationPermissions() {
  return Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });
}

export async function scheduleLocalNotificationSmokeTest() {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "Mobile Surfaces",
      body: "Native notification path is wired.",
      data: { kind: "smoke_test" },
    },
    trigger: {
      seconds: 1,
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    },
  });
}

export function canRequestPushToken() {
  return Platform.OS === "ios" && Device.isDevice;
}

export async function getDeviceApnsToken(): Promise<string | null> {
  if (!canRequestPushToken()) return null;
  const token = await Notifications.getDevicePushTokenAsync();
  return typeof token.data === "string" ? token.data : null;
}
