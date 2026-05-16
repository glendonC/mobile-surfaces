---
title: "Quickstart"
description: "Zero to a Live Activity on your Lock Screen in 30 minutes."
order: 5
group: "Start here"
---

A wall-clock 30-minute path from `npm create mobile-surfaces` to a working Live Activity rendered on a physical device. Each step calls out which trap rule (MSxxx) it addresses; if a step fails, follow the link to the catalog entry.

## Prerequisites

- macOS with Xcode 26.2 installed (Xcode major must be ≥ 26 per [MS010](/docs/traps#ms010-toolchain-preflight)).
- An iOS 17.2+ device. The simulator can render Live Activities but cannot receive APNs pushes; the full loop requires a real phone.
- Apple Developer account (free or paid; paid required only for TestFlight).
- Node 24, pnpm 10 — see [`compatibility.md`](/docs/compatibility) for the pinned row.

## 1. Scaffold (2 min)

```
npm create mobile-surfaces@latest my-app
cd my-app
```

The CLI walks through name, bundle id, and an Apple Team ID placeholder. Install completes when the harness compiles.

## 2. Simulator smoke (3 min)

```
pnpm mobile:sim
```

When the app loads, tap **Start** in the harness, then **Cmd-L** to lock the simulator. A Lock-Screen Live Activity appears. Simulators render the Lock-Screen view but Dynamic Island shows up only on Pro models; Live Activity remote pushes are device-only.

If the activity does not appear, see [troubleshooting](/docs/troubleshooting#activities-supported-no).

## 3. Mint an APNs auth key (5 min)

Live Activity remote start and update need an APNs JWT. The key is one .p8 file from the Apple Developer portal.

1. Sign in to [developer.apple.com/account](https://developer.apple.com/account) → **Certificates, Identifiers & Profiles** → **Keys**.
2. Click **+**. Name the key (e.g. `Mobile Surfaces dev`).
3. Tick **Apple Push Notifications service (APNs)**. If you need iOS 18 broadcast support, also tick **Broadcast Notifications** ([MS034](/docs/traps#ms034-broadcast-capability-must-be-enabled-on-the-apns-auth-key)).
4. Click **Continue** → **Register**.
5. Download the `.p8` file. Apple lets you download once. Save it outside the repo:

   ```
   mkdir -p ~/.mobile-surfaces
   mv ~/Downloads/AuthKey_*.p8 ~/.mobile-surfaces/
   chmod 600 ~/.mobile-surfaces/AuthKey_*.p8
   ```

6. Copy the 10-character **Key ID** from the key detail page.
7. Copy your 10-character **Team ID** from the **Membership** tab.
8. The bundle id is `expo.ios.bundleIdentifier` from `apps/mobile/app.json` (default: `com.<owner>.<project>`).

Avoid `com.example.*` — the App Store and TestFlight uploaders reject it.

## 4. Wire APNs (1 min)

```
pnpm surface:setup-apns
```

Interactive wizard. It validates the four `APNS_*` env vars and writes them to `.env.local`. The script handles the `.push-type.liveactivity` topic suffix internally — do not include it in `APNS_BUNDLE_ID` ([MS018](/docs/traps#ms018-apns-bundle-id-must-not-include-the-push-type-liveactivity-suffix)).

## 5. Install on device (5 min)

Replace the `XXXXXXXXXX` placeholder for `appleTeamId` in `apps/mobile/app.json` with your real Team ID, then:

```
pnpm mobile:run:ios:device
```

First install: Settings → General → VPN & Device Management → trust your developer profile. Then re-launch the app.

## 6. Start on device (1 min)

In the harness, tap **Start**. Lock the phone. A Lock-Screen Live Activity appears.

Note the **push-to-start token** and **per-activity push token** in the harness panel. Both are needed for the next step.

## 7. Push an update (3 min)

From your laptop, with the four `APNS_*` vars set:

```
pnpm mobile:push:device:liveactivity -- \
  --activity-token=<paste per-activity token> \
  --event=update \
  --snapshot-file=./data/surface-fixtures/active-progress.json \
  --env=development
```

The Lock Screen reflects the new state. The default priority is 5 ([MS015](/docs/traps#ms015-push-priority-5-vs-10-budget-rules)) which is correct for content-state updates; reserve 10 for transitions the user must see immediately.

## 8. Push end (1 min)

```
pnpm mobile:push:device:liveactivity -- \
  --activity-token=<paste> \
  --event=end \
  --snapshot-file=./data/surface-fixtures/completed.json \
  --env=development
```

The activity dismisses.

## What to do next

You've validated the harness end-to-end. Time to build your real app on top of it. The harness is a fixture-driven playground - your app is what you replace it with.

- **[Building your app](/docs/building-your-app)** — concrete migration steps from the harness to a production screen, with a worked package-delivery example covering domain types, snapshot derivation, state management, token forwarding, and backend send.
- [Scenarios](/docs/scenarios) — the canonical delivery flow rendered step by step across all five surfaces.
- [Concepts](/docs/concepts) — the contract, the surfaces, the adapter boundary.
- [Surfaces](/docs/surfaces) — what each `kind` actually drives.
- [Backend](/docs/backend) — domain event → snapshot → APNs walkthrough.
- [Push](/docs/push) — the wire-layer reference and SDK.
- [Observability](/docs/observability) — alertable errors and operator response.
- [Troubleshooting](/docs/troubleshooting) — symptom-to-fix recipes.

## Common 30-minute traps

- **Activity starts but never updates on push.** Check [MS013](/docs/traps#ms013-app-group-entitlement-must-match-host-app-and-widget-extension) (App Group identity across host + widget). If running on simulator, switch to device — APNs Live Activity pushes are device-only.
- **APNs returns 400 BadDeviceToken.** [MS014](/docs/traps#ms014-apns-token-environment-must-match-the-build-environment) — your token was minted by a dev-client build; the production endpoint won't accept it. Pass `--env=development`.
- **APNs returns 400 TopicDisallowed.** [MS018](/docs/traps#ms018-apns-bundle-id-must-not-include-the-push-type-liveactivity-suffix) — `APNS_BUNDLE_ID` includes the `.push-type.liveactivity` suffix. Pass the bare bundle id.
- **Remote start returns 200 but no activity appears.** [MS019](/docs/traps#ms019-fb21158660-push-to-start-tokens-silent-after-force-quit) — push-to-start tokens go silent after a force-quit until next launch. Apple radar FB21158660; ask the user to open the app once.
