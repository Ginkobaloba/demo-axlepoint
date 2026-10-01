// Asserts the Dockerfile's LAST stage is the app runtime. Run: npm test
//
// Why this check exists. `docker build` with no `--target` builds the last
// stage in the file, and cloudflare-config/scripts/deploy-demo.ps1 builds every
// demo without one -- it is shared by four demos and cannot name a stage that
// only this Dockerfile has. So stage order decides what gets deployed.
//
// On 2026-09-28 the `reset` stage sat last, `demo-axlepoint:latest` was built
// from it, and the deployed container ran `while true; npm run db:reset`. It
// reported "Up", held port 8102, and never listened on 3000. nginx and the
// tunnel returned a textbook 502 for two and a half days. Nothing failed: the
// build succeeded, the container started, and the only evidence was the absence
// of a listener.
//
// The parser is tested against a synthetic Dockerfile with the stages in the
// WRONG order, so these tests would have caught that layout rather than merely
// agreeing with the current one.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DOCKERFILE = join(dirname(fileURLToPath(import.meta.url)), "..", "Dockerfile");

/** Stage names in file order, for `FROM <image> AS <name>` lines. */
export function stageNames(text) {
  const names = [];
  for (const line of text.split("\n")) {
    const match = /^\s*FROM\s+\S+\s+AS\s+(\S+)/i.exec(line);
    if (match) names.push(match[1]);
  }
  return names;
}

/** The CMD of the last stage -- i.e. of the image a bare `docker build` makes. */
export function lastStageCmd(text) {
  const lines = text.split("\n");
  let cmd = null;
  for (const line of lines) {
    if (/^\s*FROM\s+\S+\s+AS\s+\S+/i.test(line)) cmd = null;
    const match = /^\s*CMD\s+(.*)$/i.exec(line);
    if (match) cmd = match[1].trim();
  }
  return cmd;
}

const WRONG_ORDER = [
  "FROM node:22 AS deps",
  "FROM node:22 AS build",
  "FROM node:22 AS run",
  'CMD ["node", "server.js"]',
  "FROM node:22 AS reset",
  'CMD ["sh", "-c", "while true; do npm run db:reset; done"]',
].join("\n");

describe("the parser catches the layout that caused the outage", () => {
  it("names the last stage of a wrongly-ordered Dockerfile", () => {
    const names = stageNames(WRONG_ORDER);
    expect(names.at(-1)).toBe("reset");
    expect(names.at(-1)).not.toBe("run");
  });

  it("reads the sidecar loop as what a bare build would deploy", () => {
    expect(lastStageCmd(WRONG_ORDER)).toContain("db:reset");
  });
});

describe("this repo's Dockerfile", () => {
  const text = readFileSync(DOCKERFILE, "utf8");

  it("has more than one named stage, so order is a real choice", () => {
    expect(stageNames(text).length).toBeGreaterThan(1);
  });

  it("ends with the `run` stage, because that is what gets deployed", () => {
    expect(stageNames(text).at(-1)).toBe("run");
  });

  it("still defines the `reset` stage", () => {
    // Without this, deleting the sidecar would turn the check green.
    expect(stageNames(text)).toContain("reset");
  });

  it("starts the Next server in the stage a bare `docker build` produces", () => {
    const cmd = lastStageCmd(text);
    expect(cmd).toContain("server.js");
    expect(cmd).not.toContain("db:reset");
  });
});
