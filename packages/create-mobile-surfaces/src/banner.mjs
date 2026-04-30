import pc from "picocolors";
import { splashLines } from "./copy.mjs";
import { getCliVersion } from "./template-manifest.mjs";
import { rail } from "./ui.mjs";

// The banner opens the visual flow with `┌  mobile surfaces · v0.1.0`.
// Everything that follows hangs off the same rail, so the screen reads as
// one continuous column of content rather than a pile of independent blocks.
// Inquirer prompts have their own visual treatment; the brief rail-break
// they introduce reads as "your turn".
export function renderBanner() {
  const wordmark = pc.bold("mobile surfaces");
  const version = pc.dim(`v${getCliVersion()}`);
  const sep = pc.dim("·");

  process.stdout.write("\n");
  rail.open(`${wordmark}  ${sep}  ${version}`);
  rail.blank();
  splashLines.forEach((line, i) => {
    rail.line(i === 0 ? line : pc.dim(line));
  });
  rail.blank();
}
