// Shared reading-path config consumed by both the /docs index (which
// renders the persona cards) and the docs layout (which renders the
// sticky bottom progress bar on inner pages). Keep slugs in sync with
// the docs collection ids in apps/site/src/content/docs/.

export interface ReadingPath {
  id: string;
  label: string;
  intro: string;
  slugs: string[];
}

export const READING_PATHS: ReadonlyArray<ReadingPath> = [
  {
    id: "adopt",
    label: "Already shipping Live Activities",
    intro:
      "Drop the contract and push client into your existing Expo app or backend without forking your bridge.",
    slugs: ["adopt", "push", "vs-expo-live-activity"],
  },
  {
    id: "greenfield",
    label: "Starting from zero",
    intro:
      "Scaffold an iPhone app with every surface wired up locally, ready to iterate against the simulator.",
    slugs: ["quickstart", "ios-environment", "surfaces"],
  },
  {
    id: "backend",
    label: "Backend integrator",
    intro: "Emit snapshots and send APNs pushes from Node. No mobile work.",
    slugs: ["backend", "push", "observability"],
  },
  {
    id: "triage",
    label: "Triaging a silent failure",
    intro:
      "A live bug where the Lock Screen is empty or APNs returns 200 with no effect.",
    slugs: ["troubleshooting", "traps", "push"],
  },
];
