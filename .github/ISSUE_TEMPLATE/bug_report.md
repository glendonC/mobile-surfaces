---
name: Bug report
about: Something in the Mobile Surfaces starter is broken or behaves unexpectedly.
title: ""
labels: bug
assignees: ""
---

## Summary

<!-- One sentence: what is wrong? -->

## Reproduction

1.
2.
3.

## Expected vs. actual

- Expected:
- Actual:

## Environment

Run `pnpm surface:diagnose` and attach the generated `mobile-surfaces-diagnose-<timestamp>.md` file to this issue. The output is designed to be safe to paste publicly: APNs auth values are reported only as `set`/`unset`, paths are rewritten to be home-relative, and any token-shaped or PEM content is stripped.

If you can't run `surface:diagnose` for some reason, fill in manually:

- macOS version:
- Xcode version:
- Node version (`node -v`):
- pnpm version (`pnpm -v`):
- iOS simulator / device:
- Mobile Surfaces commit (`git rev-parse HEAD`):
- Renamed via `pnpm surface:rename`? yes / no

## Logs

<!-- Metro logs, Xcode build output, APNs response body, etc. Use a fenced code block. -->

```
```

## Anything else

<!-- Workarounds tried, related issues, screenshots. -->
