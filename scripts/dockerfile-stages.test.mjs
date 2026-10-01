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

// Split on CRLF *or* LF. Not defensive padding: git checks the Dockerfile out
// with CRLF on Windows and LF on the Linux runner (verified: `file Dockerfile`
// reports CRLF terminators here). A parser that splits on a bare newline then
// leaves a trailing carriage return on every line. The CMD regex below ends in
// `$`, and in JavaScript `.` does not match a carriage return, so the capture
// silently fails to match -- lastStageCmd returned null locally while CI, which
// checks out LF, stayed green. A guard that holds on only one platform is worse
// than none, because the green run is the one people look at.
const LINES = /\r?\n/;

/** Stage names in file order, for `FROM <image> AS <name>` lines. */
export function stageNames(text) {
  const names = [];
  for (const line of text.split(LINES)) {
    const match = /^\s*FROM\s+\S+\s+AS\s+(\S+)/i.exec(line);
    if (match) names.push(match[1]);
  }
  return names;
}

/** The CMD of the last stage -- i.e. of the image a bare `docker build` makes. */
export function lastStageCmd(text) {
  const lines = text.split(LINES);
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

  // Regression, 2026-10-01. The committed Dockerfile is checked out CRLF on
  // Windows and LF on the Linux runner. Splitting on a bare newline left a
  // trailing carriage return that made lastStageCmd return null, so this file's
  // central assertion failed locally and passed in CI. Both line endings must
  // parse identically, and the asymmetry is the whole danger: the platform that
  // reported green was the one nobody doubted.
  it("parses CRLF exactly as it parses LF", () => {
    const crlf = WRONG_ORDER.replace(/\n/g, "\r\n");
    expect(crlf).toContain("\r\n");
    expect(stageNames(crlf)).toEqual(stageNames(WRONG_ORDER));
    expect(lastStageCmd(crlf)).toBe(lastStageCmd(WRONG_ORDER));
    expect(lastStageCmd(crlf)).not.toBeNull();
  });

  it("finds a CMD on a CRLF line at all", () => {
    // The narrowest statement of the bug: one stage, one CMD, CRLF endings.
    const one = 'FROM node:22 AS run\r\nCMD ["node", "server.js"]\r\n';
    expect(lastStageCmd(one)).toContain("server.js");
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
