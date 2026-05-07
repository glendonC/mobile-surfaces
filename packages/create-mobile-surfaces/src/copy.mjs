// All user-facing text lives here so the voice can be tuned in one place.
// Voice rules: direct, calm, second-person. No exclamation marks. Sentences
// not bullet fragments. Plain English the first time a technical term appears.

// The splash subtitle. First line says what it is, second line says
// what's wired so a stranger gets the value in under three seconds.
// Kept short so it renders on any terminal width. Plain strings — the
// banner module decides which gets bold vs dim.
export const splashLines = [
  "Expo iOS starter for Live Activities and Dynamic Island.",
  "ActivityKit, WidgetKit, and push wiring already done.",
];

// Kept for any one-liner usage.
export const tagline = "live activities and dynamic island for expo iOS";

export const welcome = "Let's set up your Live Activity starter. About 90 seconds.";

// Each prompt's `message` is the exact text Inquirer renders before the
// `›` cursor. Inquirer renders `(default)` automatically when a default is
// passed, so suggested values come for free; explanatory hints go in the
// message itself for the prompts that need them.
export const prompts = {
  projectName: {
    message: "Project name (folder + iOS Settings display name)",
  },
  scheme: {
    message: "URL scheme (used in deep links like myapp://…)",
  },
  bundleId: {
    message: "Bundle identifier (reverse-DNS, lowercase — replace com.example.*)",
  },
  teamId: {
    message: "Apple Team ID (skip if simulator-only)",
  },
  surfaces: {
    homeWidget: {
      message: "Include home-screen widget?",
    },
    controlWidget: {
      message: "Include iOS 18 control widget?",
    },
  },
  install: {
    message: "Install dependencies and prepare iOS now?",
    yes: "Yes, install and prepare",
    yesHint: "runs pnpm install + expo prebuild (about a minute)",
    no: "No, I'll run them myself",
  },
  installExisting: {
    message: "Run expo prebuild now to wire iOS up?",
    yes: "Yes, run prebuild after",
    yesHint: "packages get added either way; prebuild adds about a minute",
    no: "No, I'll run prebuild myself",
  },
  confirm: {
    message: "Ready to scaffold?",
    yes: "Looks good, scaffold it",
    no: "Start over",
  },
};

export const cancelled = "Cancelled. No files written.";

export const successTitle = "All set. Your project is ready.";

export const existingSuccessTitle = "Mobile Surfaces is wired up.";

export const existingSuccessSections = ({ projectName, packageManager }) => ({
  tryItNow: [
    `${packageManager} run mobile:dev-client     start the dev server`,
    `npx expo run:ios                  build & launch on the simulator`,
  ],
  learnMore: [
    "docs/architecture.md     the data shape behind everything",
    "docs/troubleshooting.md  when something breaks",
    "README.md                quick start",
  ],
});

export const successSections = (projectName, { installNow = true } = {}) => ({
  inTheBox:
    "Live Activity harness, Dynamic Island layouts, push smoke scripts,\ncontract-first fixtures, doctor checks.",
  // tryItNow stays push-free so first-run users get a working Live Activity
  // before any APNs setup. Push commands graduate to "when you're ready"
  // since they need APNs env vars.
  //
  // When installNow=false the user picked --no-install (or answered No to
  // the install prompt). pnpm mobile:sim assumes deps + prebuild already
  // ran, so we prefix with mobile:bootstrap (install + prebuild) so the
  // user has one well-ordered chain instead of debugging an opaque
  // prebuild failure caused by missing node_modules.
  tryItNow: installNow
    ? [
        `cd ${projectName}`,
        "pnpm mobile:sim          build & launch on the simulator",
        "tap Start in the harness, then ⌘L in the simulator to see your Live Activity on the Lock Screen",
      ]
    : [
        `cd ${projectName}`,
        "pnpm mobile:bootstrap    install deps + prepare iOS (about a minute)",
        "pnpm mobile:sim          build & launch on the simulator",
        "tap Start in the harness, then ⌘L in the simulator to see your Live Activity on the Lock Screen",
      ],
  whenReady: [
    "pnpm surface:setup-apns                 wire APNs creds with a guided wizard",
    "pnpm mobile:push:sim                    send a test push to the simulator",
    "pnpm mobile:run:ios:device              run it on your iPhone",
    "pnpm mobile:push:device:liveactivity    push a real Live Activity update",
    "pnpm dev:doctor                         re-check your toolchain anytime",
  ],
  learnMore: [
    "README.md                quick start",
    "docs/architecture.md     the data shape behind everything",
    "docs/troubleshooting.md  when something breaks",
  ],
});

export const errors = {
  toolchainHeader: (n) =>
    n === 1
      ? "One thing to fix before we can continue:"
      : `${n} things to fix before we can continue:`,
  dirNotEmpty: (dir) =>
    `./${dir} already exists and isn't empty.\nChoose a different name, or remove it and run again.`,
  installFailed: (dir) =>
    `pnpm install failed.\n\nThe scaffold was rolled back — no files were left at ./${dir}.\nFix the underlying issue and re-run:\n  npm create mobile-surfaces@latest ${dir}\n\nSee docs/troubleshooting.md if it keeps failing.`,
  pnpmMissing: (dir) =>
    `pnpm isn't on your PATH, but the Mobile Surfaces template ships a\npnpm-lock.yaml. The scaffold was rolled back — nothing landed at\n./${dir}. Enable pnpm and re-run:\n  corepack enable pnpm\n  npm create mobile-surfaces@latest ${dir}`,
  cocoapodsMissing: (dir) =>
    `CocoaPods isn't on your PATH. expo prebuild needs it to install\niOS pods. The scaffold was rolled back — nothing landed at ./${dir}.\nInstall CocoaPods and re-run:\n  brew install cocoapods    # or: sudo gem install cocoapods\n  npm create mobile-surfaces@latest ${dir}`,
  installInterrupted: (dir) =>
    `Stopped. The scaffold was rolled back — nothing landed at ./${dir}.\nRe-run when you're ready:\n  npm create mobile-surfaces@latest ${dir}`,
  applyFailed:
    "Something failed while applying changes to your project.\nNo files were rolled back; review the log to see how far we got.",
  applyInterrupted:
    "Stopped midway through applying changes. Some changes may\nhave landed; review your git status and the log.",
};

// Refuse-path copy. Each non-Expo reason gets a tailored message because the
// fix is different in each case. The voice rules from the rest of the CLI
// apply: direct, name the next concrete step, no apology language.
export const refuse = {
  noPackageJson:
    "This directory has files in it but no package.json, so I can't\ntell what kind of project this is.\n\nIf you want to create a new project, cd to an empty directory\nand run me again. If this is an existing iOS-only Xcode project,\nMobile Surfaces only works inside Expo apps — that's a different\nproduct.",
  invalidPackageJson: (cwd) =>
    `The package.json at ${cwd} isn't valid JSON. Fix it (or restore\nit from git) and run me again.`,
  noExpoDep: (packageName) =>
    `${packageName} is a JavaScript project, but it doesn't use Expo.\n\nMobile Surfaces requires Expo for the dev client and the iOS\nbuild pipeline. The fastest paths in:\n\n  • Add Expo to this project:  npx install-expo-modules@latest\n  • Or start fresh:            cd .. && npm create mobile-surfaces my-app\n\nThen run me again.`,
  appsMobileExists: (packageName) =>
    `${packageName} already has an apps/mobile/ directory, so this looks\nlike it's already been scaffolded once.\n\nIf you want to add Mobile Surfaces to an existing Expo app,\ncd into apps/mobile/ and run me again from there. If you\nwanted a fresh start, remove apps/mobile/ first.`,
};

// Copy for the existing-monorepo-no-expo flow (a TS monorepo without Expo,
// where we'll scaffold apps/mobile/ inside their workspace).
export const monorepo = {
  intro: "We'll add Mobile Surfaces as apps/mobile/ in your workspace.",
  successTitle: "Mobile Surfaces is wired up.",
};
