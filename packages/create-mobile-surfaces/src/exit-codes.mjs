// Canonical exit-code contract for the CLI. CI consumers branch on these,
// so the values are part of the public surface — changing them is breaking.
//
//   0   success — including help, EPIPE, and user-cancelled prompts where
//                 cancelling is a valid choice (no work was wasted).
//   1   user-error — bad flags, --yes missing required fields, target
//                    directory not empty, can't-scaffold-here refusals.
//                    Fix is on the user's side: change the inputs.
//   2   environment-error — preflight failed, pnpm/CocoaPods missing on
//                           PATH, install failed, prebuild failed, apply
//                           phase threw. Fix is in the user's environment:
//                           install missing tools, free disk space, retry.
//   3   template-error — template tarball or manifest could not be located
//                        or parsed. The published CLI is broken; user can't
//                        do anything but report it.
//   130 interrupted — Ctrl+C / SIGINT during a task. POSIX convention:
//                     128 + signal number (SIGINT = 2).
//
// The categories are deliberately coarse so adding a new failure path
// doesn't require a new code; just pick the closest existing bucket. If
// you find yourself wanting a fifth category, talk to the maintainers
// first — every new code is a thing CI scripts have to learn.

export const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  USER_ERROR: 1,
  ENV_ERROR: 2,
  TEMPLATE_ERROR: 3,
  INTERRUPTED: 130,
});
