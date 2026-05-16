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
    id: "backend",
    label: "Backend integrator",
    intro: "Emit snapshots and send APNs pushes from Node. No mobile work.",
    slugs: ["backend-integration", "push", "troubleshooting"],
  },
  {
    id: "mobile",
    label: "Mobile app developer",
    intro: "An iPhone app on the starter with every surface wired up locally.",
    slugs: ["ios-environment", "multi-surface", "troubleshooting"],
  },
  {
    id: "foreign",
    label: "Foreign Expo integrator",
    intro: "An existing Expo app that adopts Mobile Surfaces without forking.",
    slugs: ["compatibility", "architecture", "schema-migration"],
  },
  {
    id: "triage",
    label: "Triaging a silent failure",
    intro:
      "A live bug where the Lock Screen is empty or APNs returns 200 with no effect.",
    slugs: ["troubleshooting", "push", "observability"],
  },
];
