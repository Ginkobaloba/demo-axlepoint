import { defineConfig } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// Flat-config replacement for the old .eslintrc.json
// ({ "extends": ["next/core-web-vitals", "next/typescript"] }), run through
// the ESLint CLI because `next lint` passes eslintrc-only options that
// ESLint 10 rejects. eslint-config-next already ignores .next/, out/,
// build/ and next-env.d.ts.
export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // ESLint 10 removed context.getFilename(). eslint-plugin-react 7.37.5
    // (latest, peer range tops out at eslint ^9.7) still calls it while
    // resolving `version: "detect"`, which eslint-config-next sets, and
    // crashes. An explicit version skips detection. Bump this when React
    // is upgraded.
    settings: { react: { version: "18.3" } },
  },
  {
    // react-hooks 7 (pulled in by eslint-config-next 16) added
    // set-state-in-effect, which never ran against this repo while lint
    // was broken. These four sites predate it and need real refactors
    // (ParadigmBanner is also a canonical copy that must stay in sync
    // with the other demo repos), so they warn for now; new code still
    // gets the error.
    // Follow-up: fix the sites and delete this block.
    files: [
      "src/components/paradigm-banner.tsx",
      "src/components/portal-handoff-claim.tsx",
      "src/components/schedule-board.tsx",
      "src/components/sensor-chart.tsx",
    ],
    rules: { "react-hooks/set-state-in-effect": "warn" },
  },
]);
