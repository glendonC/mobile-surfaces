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
