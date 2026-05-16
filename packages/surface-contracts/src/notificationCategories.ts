// Canonical registry of UNNotificationCategory identifiers Mobile Surfaces
// projects ship by default. This module is the source of truth; every other
// declaration site (the TS constant used at host launch, the Swift constant
// referenced by the notification-content extension, the extension's
// Info.plist UNNotificationExtensionCategory key, the `notification.category`
// values fixtures may emit) is codegened from it via
// scripts/generate-notification-categories.mjs.
//
// The schema constraint on `liveSurfaceNotificationSlice.category` (a
// z.enum over the ids declared below) is what makes drift between this
// registry and any committed snapshot statically impossible.
//
// Why a TS module rather than a JSON file under data/: this file is consumed
// at module load by the schema itself, so the registry has to be importable
// from TS code. The codegen script reads the same module and emits the
// derived artifacts. Backends or non-TS consumers can read the same data
// through the codegen output's TS / Swift constants or via the published
// JSON Schema, both of which name every legal category id.

import { z } from "zod";

/**
 * Category identifier format.
 *
 * - lowercase ASCII
 * - dotted-namespace segments allowed (`app.calendar.meeting-invitation`)
 * - hyphens and underscores allowed within a segment
 * - must start with a letter
 *
 * Apple's own UNNotificationCategory examples mix hyphens and underscores;
 * we permit both rather than forcing one in. Generated Swift symbols
 * camel-case across separators (e.g. `surface-update` -> `surfaceUpdate`).
 */
export const notificationCategoryId = z
  .string()
  .regex(/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*$/)
  .describe(
    "UNNotificationCategory identifier. Lowercase ASCII, dotted-namespace " +
      "segments, hyphens and underscores allowed within a segment, starts " +
      "with a letter.",
  );
export type NotificationCategoryId = z.infer<typeof notificationCategoryId>;

/**
 * One UNNotificationCategory action button. The reference architecture
 * currently ships zero actions (see Mobile Surfaces v6 RFC); this schema
 * declares the shape so future product code can extend the registry without
 * a contract bump.
 */
export const notificationCategoryAction = z
  .object({
    id: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .describe(
        "UNNotificationAction identifier. Used at registration time and as " +
          "the response identifier the host delegate receives.",
      ),
    title: z.string().min(1).describe("Action button label."),
    options: z
      .object({
        foreground: z.boolean().optional(),
        destructive: z.boolean().optional(),
        authenticationRequired: z.boolean().optional(),
      })
      .strict()
      .optional()
      .describe(
        "UNNotificationActionOptions flags. Mirrors the Apple " +
          "options bitmask; presence of true on a field equals OR-ing the " +
          "matching Apple constant in.",
      ),
  })
  .strict();
export type NotificationCategoryAction = z.infer<
  typeof notificationCategoryAction
>;

export const notificationCategory = z
  .object({
    id: notificationCategoryId,
    description: z
      .string()
      .min(1)
      .describe(
        "Documentation-only. Surfaces in the rendered AGENTS.md and the " +
          "category index page on the docs site. Never on the wire.",
      ),
    actions: z
      .array(notificationCategoryAction)
      .max(10)
      .describe(
        "Action buttons rendered beneath the notification. iOS hard caps " +
          "at ten. v6 ships zero categories with actions; future product " +
          "code may extend the registry without a contract bump.",
      ),
  })
  .strict();
export type NotificationCategory = z.infer<typeof notificationCategory>;

export const notificationCategoryRegistry = z
  .object({
    schemaVersion: z
      .literal("1")
      .describe(
        "Registry schema version. Distinct from the wire-format " +
          "schemaVersion that lives on LiveSurfaceSnapshot.",
      ),
    categories: z.array(notificationCategory),
  })
  .strict();
export type NotificationCategoryRegistry = z.infer<
  typeof notificationCategoryRegistry
>;

/**
 * The canonical registry. v6 ships one zero-action category: `surface-update`.
 * It is the routing key the bundled notification-content extension listens
 * on, and the value every committed notification fixture emits via
 * `notification.category`.
 *
 * Adding a category: extend the array below, run `pnpm surface:codegen`, and
 * verify the generated TS/Swift/Info.plist diff matches expectation. The
 * schema validates the entry at module load, so a malformed id surfaces
 * immediately at import.
 */
export const NOTIFICATION_CATEGORIES = {
  schemaVersion: "1",
  categories: [
    {
      id: "surface-update",
      description:
        "Default Mobile Surfaces notification category. Routes a " +
        "kind: notification snapshot into the bundled " +
        "UNNotificationContentExtension. Ships with zero action buttons; " +
        "extend the registry to declare actions per product domain.",
      actions: [],
    },
  ],
} as const satisfies NotificationCategoryRegistry;

// Defense in depth: parse the registry at module load so a hand-edit typo
// surfaces before codegen runs. Same pattern Zod schemas use elsewhere.
notificationCategoryRegistry.parse(NOTIFICATION_CATEGORIES);

/**
 * Flat string-tuple view used by Zod's enum constraint on
 * `liveSurfaceNotificationSlice.category`. Keeping the tuple narrow lets
 * the snapshot schema reject category values that are not in the registry
 * at parse time.
 */
export const NOTIFICATION_CATEGORY_IDS = NOTIFICATION_CATEGORIES.categories.map(
  (c) => c.id,
) as unknown as readonly [string, ...string[]];
