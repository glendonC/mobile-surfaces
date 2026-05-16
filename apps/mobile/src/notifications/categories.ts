// Host-side registration of UNNotificationCategory identifiers. Invoked once
// at app launch so iOS knows which `aps.category` values to route into the
// bundled UNNotificationContentExtension and which action buttons to render
// beneath the notification banner.
//
// The category set is codegened from the canonical TS registry at
// packages/surface-contracts/src/notificationCategories.ts via
// scripts/generate-notification-categories.mjs (trapId MS037). Hand-editing
// the imported constant is a stage-2 drift failure; the codegen reverts it
// on the next run.
//
// Order of operations matters: register the categories before any
// notification arrives, otherwise the system has nothing to match
// `aps.category` against and falls back to the default chrome silently.
// Call this from the same launch path that calls
// requestNotificationPermissions; the two together are the host-side
// prerequisites for the notification surface.

import * as Notifications from "expo-notifications";
import { NOTIFICATION_CATEGORIES } from "../generated/notificationCategories";

/**
 * Register every Mobile Surfaces notification category with the system.
 * Safe to call more than once; setNotificationCategoryAsync overwrites the
 * existing registration for each id rather than appending.
 *
 * Returns the number of categories registered. The host harness logs this
 * during startup so a contributor can verify the registration happened.
 */
export async function registerNotificationCategories(): Promise<number> {
  for (const category of NOTIFICATION_CATEGORIES) {
    await Notifications.setNotificationCategoryAsync(
      category.id,
      // The host registers zero action buttons by default. When the
      // canonical registry grows actions, map them through here. expo-
      // notifications' API matches Apple's UNNotificationAction shape:
      // identifier + buttonTitle + options bitmask.
      category.actions.map((action) => ({
        identifier: action.id,
        buttonTitle: action.title,
        options: {
          opensAppToForeground: action.options?.foreground ?? false,
          isDestructive: action.options?.destructive ?? false,
          isAuthenticationRequired:
            action.options?.authenticationRequired ?? false,
        },
      })),
    );
  }
  return NOTIFICATION_CATEGORIES.length;
}
