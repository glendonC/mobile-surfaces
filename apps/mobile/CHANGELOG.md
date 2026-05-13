# mobile-surfaces-app

## 1.0.10

### Patch Changes

- Add harness refresh buttons for the lockAccessory and StandBy surfaces. Both wire to the existing `refreshLockAccessorySurface` / `refreshStandbySurface` helpers in `surfaceStorage`, which were already shipping the entries into the App Group; the harness UI now has a way to exercise them. Sections are gated by the matching surface markers so the strip pipeline preserves them only when those surfaces are scaffolded in.
- Updated dependencies
  - @mobile-surfaces/surface-contracts@3.1.0
  - @mobile-surfaces/design-tokens@3.1.0
  - @mobile-surfaces/live-activity@3.1.0

## 1.0.9

### Patch Changes

- Updated dependencies for the v2 schema release. The workspace deps are now on `@mobile-surfaces/surface-contracts@3.0.0`, `@mobile-surfaces/design-tokens@3.0.0`, and `@mobile-surfaces/live-activity@3.0.0`. The harness reads through projection helpers, which were updated upstream; no consumer-side code changes were required in this app.

## 1.0.8

### Patch Changes

- Updated dependencies [870f437]
  - @mobile-surfaces/surface-contracts@2.1.1
  - @mobile-surfaces/design-tokens@2.1.1
  - @mobile-surfaces/live-activity@2.1.1

## 1.0.7

### Patch Changes

- Updated dependencies [4645fc6]
- Updated dependencies [4645fc6]
- Updated dependencies [4645fc6]
- Updated dependencies [5067bde]
- Updated dependencies [5067bde]
- Updated dependencies [cdaa373]
- Updated dependencies [b89b0fa]
- Updated dependencies [4092847]
- Updated dependencies [effc0f6]
- Updated dependencies [4645fc6]
- Updated dependencies [7a5d0a1]
- Updated dependencies [4645fc6]
  - @mobile-surfaces/surface-contracts@2.1.0
  - @mobile-surfaces/design-tokens@2.1.0
  - @mobile-surfaces/live-activity@2.1.0

## 1.0.6

### Patch Changes

- Updated dependencies [8dbe2ad]
  - @mobile-surfaces/surface-contracts@2.0.2
  - @mobile-surfaces/design-tokens@2.0.2
  - @mobile-surfaces/live-activity@2.0.2

## 1.0.5

### Patch Changes

- Updated dependencies [b270fa1]
- Updated dependencies [9bf2d87]
- Updated dependencies [72dee5f]
- Updated dependencies [0166297]
  - @mobile-surfaces/surface-contracts@2.0.1
  - @mobile-surfaces/design-tokens@2.0.1
  - @mobile-surfaces/live-activity@2.0.1

## 1.0.4

### Patch Changes

- Updated dependencies [86f811a]
  - @mobile-surfaces/surface-contracts@2.0.0
  - @mobile-surfaces/design-tokens@2.0.0
  - @mobile-surfaces/live-activity@2.0.0

## 1.0.3

### Patch Changes

- Updated dependencies [b717416]
  - @mobile-surfaces/surface-contracts@1.3.0
  - @mobile-surfaces/design-tokens@1.3.0
  - @mobile-surfaces/live-activity@1.3.0

## 1.0.2

### Patch Changes

- Updated dependencies [2de238f]
- Updated dependencies [2de238f]
  - @mobile-surfaces/surface-contracts@1.2.0
  - @mobile-surfaces/design-tokens@1.2.0
  - @mobile-surfaces/live-activity@1.2.0

## 1.0.1

### Patch Changes

- Updated dependencies [0fd08f4]
  - @mobile-surfaces/surface-contracts@1.0.0
  - @mobile-surfaces/design-tokens@1.0.0
  - @mobile-surfaces/live-activity@1.0.0
