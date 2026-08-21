import type { CoverageState } from "@/lib/drift";
import { COVERAGE_LABEL } from "@/lib/format";

/**
 * The coverage-state marker — a dot plus a mono label, styled by
 * `.bam-state--{state}` in globals.css.
 *
 * This is the single place the four states become pixels, which is what keeps
 * the one-accent law enforceable: red is reachable only by passing
 * `state="uncovered"`, and it means exactly one thing — the deployed code
 * drifted from every audit. A server component; it has no interactivity.
 */
export function StateMarker({ state }: { state: CoverageState }) {
  return (
    <span className={`bam-state bam-state--${state}`}>
      {COVERAGE_LABEL[state]}
    </span>
  );
}
