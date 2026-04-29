import pc from "picocolors";
import { tagline } from "./copy.mjs";
import { getCliVersion } from "./template-manifest.mjs";

// A small phone pictogram — outer frame, inner Lock Screen, one notification
// dot. Editable in place: the source looks like the rendered shape.
const pictogram = `
┌─────────┐
│┌───────┐│
││  ●    ││
│└───────┘│
└─────────┘
`.trim().split("\n");

// Compose two columns side by side: the cyan pictogram on the left, and the
// wordmark / subtitle pinned to specific rows on the right. Other rows on
// the right are blank so the pictogram stands alone there.
function compose({ left, right, padding, gutter }) {
  return left
    .map((row, i) => {
      const rightCol = right[i] ?? "";
      return padding + pc.cyan(row) + (rightCol ? gutter + rightCol : "");
    })
    .join("\n");
}

export function renderBanner() {
  const right = new Array(pictogram.length).fill("");
  right[2] = pc.bold("MOBILE SURFACES");
  right[3] = pc.dim(`${tagline} · v${getCliVersion()}`);

  const banner = compose({
    left: pictogram,
    right,
    padding: "   ",
    gutter: "   ",
  });

  process.stdout.write(banner + "\n\n");
}
