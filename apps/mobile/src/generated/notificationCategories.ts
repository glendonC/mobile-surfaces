// GENERATED - DO NOT EDIT. Source: packages/surface-contracts/src/notificationCategories.ts.
// Regenerate: pnpm surface:codegen

// Mirror of NOTIFICATION_CATEGORIES from the canonical TS source, in a
// host-importable shape. The notifications module passes this directly
// into UNUserNotificationCenter.setNotificationCategoriesAsync at app
// launch so the registered set always matches the wire categories.
export type NotificationCategoryActionOptions = {
  foreground?: boolean;
  destructive?: boolean;
  authenticationRequired?: boolean;
};

export type NotificationCategoryAction = {
  id: string;
  title: string;
  options?: NotificationCategoryActionOptions;
};

export type NotificationCategory = {
  id: string;
  actions: readonly NotificationCategoryAction[];
};

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  {
    id: "surface-update",
    actions: [],
  },
] as const;

export const NOTIFICATION_CATEGORY_IDS = NOTIFICATION_CATEGORIES.map(
  (c) => c.id,
) as readonly string[];
