# Scripts

Local scripts for the Mobile Surfaces Live Activity and Dynamic Island dev workflow.

## Setup And Checks

```bash
pnpm dev:setup
pnpm dev:doctor
pnpm surface:check
pnpm typecheck
```

`surface:check` validates deterministic fixtures, checks the generated TypeScript fixture export, and confirms the two ActivityKit attribute files are byte-identical.

## Simulator Push

```bash
pnpm mobile:push:sim
pnpm mobile:push:sim -- com.example.mobilesurfaces
```

This uses `xcrun simctl push` with a smoke-test alert payload.

## APNs Smoke Tests

Store APNs keys outside the repo:

```bash
mkdir -p ~/.mobile-surfaces
mv ~/Downloads/AuthKey_*.p8 ~/.mobile-surfaces/
chmod 600 ~/.mobile-surfaces/AuthKey_*.p8
```

Required environment:

```bash
export APNS_KEY_PATH="$HOME/.mobile-surfaces/AuthKey_XXXXXXXXXX.p8"
export APNS_KEY_ID="XXXXXXXXXX"
export APNS_TEAM_ID="XXXXXXXXXX"
export APNS_BUNDLE_ID="com.example.mobilesurfaces"
```

Regular alert:

```bash
pnpm mobile:push:device:alert -- \
  --device-token=<apns-device-token> \
  --snapshot-file=./data/surface-fixtures/queued.json \
  --env=development
```

Live Activity update:

```bash
pnpm mobile:push:device:liveactivity -- \
  --activity-token=<activity-token> \
  --event=update \
  --state-file=./scripts/sample-state.json \
  --env=development
```

Live Activity remote start (iOS 17.2+) using a fixture as the attributes source:

```bash
pnpm mobile:push:device:liveactivity -- \
  --activity-token=<push-to-start-token> \
  --event=start \
  --attributes-file=./data/surface-fixtures/queued.json \
  --state-file=./scripts/sample-state.json \
  --env=development
```

`--event=start` requires:

- `--activity-token`: the push-to-start token from `Activity<…>.pushToStartTokenUpdates` (not the per-activity token used by `update` / `end`).
- `--attributes-file`: a JSON file with `surfaceId` and `modeLabel`. Surface fixtures already match this shape.
- `--attributes-type`: defaults to `MobileSurfacesActivityAttributes`. Override to match your Swift attributes struct after `pnpm surface:rename`.

Live Activity end with explicit dismissal:

```bash
pnpm mobile:push:device:liveactivity -- \
  --activity-token=<activity-token> \
  --event=end \
  --state-file=./scripts/sample-state.json \
  --dismissal-date=$(date -v +5M +%s) \
  --env=development
```

Useful flags for any Live Activity event:

- `--stale-date=<unix-seconds>`: when iOS should dim the activity as stale.
- `--dismissal-date=<unix-seconds>`: when iOS should remove a `--event=end` activity from the Lock Screen. Defaults to now if omitted on `--event=end`.

Live Activity pushes default to `apns-priority: 5`. Apple rate-limits priority 10
updates aggressively, so use it only for updates the user must see immediately:

```bash
pnpm mobile:push:device:liveactivity -- \
  --activity-token=<activity-token> \
  --event=update \
  --priority=10 \
  --state-file=./scripts/sample-state.json \
  --env=development
```

Use `--env=production` for TestFlight and App Store builds.
