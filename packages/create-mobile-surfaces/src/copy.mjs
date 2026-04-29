// All user-facing text lives here so the voice can be tuned in one place.
// Voice rules: direct, calm, second-person. No exclamation marks. Sentences
// not bullet fragments. Plain English the first time a technical term appears.

export const tagline = "live activities for expo iOS";

export const welcome = "Let's set up your Live Activity starter. About 90 seconds.";

export const prompts = {
  projectName: {
    message: "Project name",
    helper:
      "Used as the folder name and the default display name in iOS Settings.\nLowercase, words-and-dashes only. You can change this later.",
    placeholder: "lockscreen-demo",
  },
  scheme: {
    message: "URL scheme",
    helper:
      "Lets your app be opened from links like lockscreendemo://surface/123.\nLowercase letters and digits, starts with a letter.",
  },
  bundleId: {
    message: "Bundle identifier",
    helper:
      "How iOS identifies your app. Reverse-DNS, lowercase.\ncom.<your-domain>.<app> if you have a domain, com.example.<app> if not.",
  },
  teamId: {
    message: "Apple Team ID",
    helper:
      "Required to sign builds for a real iPhone. Skip if you'll only\nuse the simulator for now. Find it at developer.apple.com → Membership.",
  },
  install: {
    message: "Install dependencies and prepare iOS now?",
    helper:
      "Runs pnpm install and expo prebuild. Adds about a minute.",
    yes: "Yes, install and prepare",
    no: "No, I'll run them myself",
  },
  installExisting: {
    message: "Run expo prebuild now to wire iOS up?",
    helper:
      "Packages get added either way. Prebuild generates the iOS\nproject from your app config. Adds about a minute.",
    yes: "Yes, run prebuild after",
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

export const successSections = (projectName) => ({
  inTheBox:
    "Live Activity harness, Dynamic Island layouts, push smoke scripts,\ncontract-first fixtures, doctor checks.",
  tryItNow: [
    `cd ${projectName}`,
    "pnpm mobile:sim          build & launch on the simulator",
    "pnpm mobile:push:sim     send a test push to the simulator",
  ],
  whenReady: [
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
    `pnpm install failed.\n\nYour project is at ./${dir}. The scaffold is complete; only\ndependency installation failed. Try:\n  cd ${dir} && pnpm install\n\nStill failing? See docs/troubleshooting.md.`,
  installInterrupted: (dir) =>
    `Stopped. Your project is at ./${dir}, but install didn't\nfinish. Resume with:\n  cd ${dir} && pnpm install`,
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
};
