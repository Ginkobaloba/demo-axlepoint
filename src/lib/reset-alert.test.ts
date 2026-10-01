// Tests for the reset alert destinations. Run: npm test
//
// The case that matters is chat.postMessage answering HTTP 200 with
// {"ok": false}. Slack refuses that way, and the webhook path's HTTP-status
// check -- correct for a webhook -- would have called that a delivered alert.
// An alerting path that reports success when nothing was sent is the worst
// available false pass, because this code's only job is to speak up when
// something else failed.
import { describe, expect, it } from "vitest";

import {
  ALERT_OPTOUT,
  deliverAlert,
  resolveAlertTarget,
  type AlertTarget,
  type FetchLike,
} from "./reset-alert";

const WEBHOOK = "https://hooks.slack.test/services/AAA/BBB/CCC";
const TOKEN = "xoxb-test-token-value";
const CHANNEL = "D0C2YKLSTLM";

/** Records what was sent and answers with a canned response. */
function recorder(response: { status: number; body?: unknown; bodyIsJson?: boolean }) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => {
        if (response.bodyIsJson === false) throw new SyntaxError("not json");
        return response.body;
      },
    } as unknown as Response;
  };
  return { calls, fetchImpl };
}

describe("resolveAlertTarget", () => {
  it("takes a webhook url", () => {
    const r = resolveAlertTarget({ RESET_ALERT_WEBHOOK: WEBHOOK });
    expect(r.target).toEqual({ kind: "webhook", url: WEBHOOK });
    expect(r.error).toBeNull();
  });

  it("takes a bot token with a channel", () => {
    const r = resolveAlertTarget({
      RESET_ALERT_SLACK_TOKEN: TOKEN,
      RESET_ALERT_SLACK_CHANNEL: CHANNEL,
    });
    expect(r.target).toEqual({ kind: "slack-bot", token: TOKEN, channel: CHANNEL });
    expect(r.error).toBeNull();
  });

  // The half-configured cases are the point of the function, not edge cases.
  // Treating them as "no destination" would turn a typo into silent loss of
  // alerting, which is the failure the refusal exists to prevent.
  it("REFUSES a token with no channel", () => {
    const r = resolveAlertTarget({ RESET_ALERT_SLACK_TOKEN: TOKEN });
    expect(r.target).toBeNull();
    expect(r.error).toContain("RESET_ALERT_SLACK_CHANNEL is not");
  });

  it("REFUSES a channel with no token", () => {
    const r = resolveAlertTarget({ RESET_ALERT_SLACK_CHANNEL: CHANNEL });
    expect(r.target).toBeNull();
    expect(r.error).toContain("RESET_ALERT_SLACK_TOKEN is not");
  });

  it("refuses a half-set token even when the opt-out is present", () => {
    // Otherwise a stray opt-out would mask a misconfiguration rather than the
    // operator being told their token names nowhere.
    const r = resolveAlertTarget({
      RESET_ALERT_SLACK_TOKEN: TOKEN,
      RESET_ALERT_OPTOUT: ALERT_OPTOUT,
    });
    expect(r.target).toBeNull();
    expect(r.error).toContain("RESET_ALERT_SLACK_CHANNEL is not");
  });

  it("treats whitespace-only values as absent", () => {
    const r = resolveAlertTarget({
      RESET_ALERT_WEBHOOK: "   ",
      RESET_ALERT_SLACK_TOKEN: "\t",
      RESET_ALERT_SLACK_CHANNEL: " ",
    });
    expect(r.target).toBeNull();
    expect(r.error).toContain("No alert destination is configured");
  });

  it("prefers the webhook when both are set, and says so", () => {
    const r = resolveAlertTarget({
      RESET_ALERT_WEBHOOK: WEBHOOK,
      RESET_ALERT_SLACK_TOKEN: TOKEN,
      RESET_ALERT_SLACK_CHANNEL: CHANNEL,
    });
    expect(r.target).toEqual({ kind: "webhook", url: WEBHOOK });
    expect(r.warnings.join(" ")).toContain("narrower credential");
  });

  it("refuses with no destination and no opt-out", () => {
    const r = resolveAlertTarget({});
    expect(r.target).toBeNull();
    expect(r.error).toContain("A reset that fails silently is worse");
  });

  it("accepts the exact opt-out string only", () => {
    expect(resolveAlertTarget({ RESET_ALERT_OPTOUT: ALERT_OPTOUT }).target).toEqual({
      kind: "optout",
    });
    expect(resolveAlertTarget({ RESET_ALERT_OPTOUT: "yes" }).target).toBeNull();
  });
});

describe("deliverAlert over a webhook", () => {
  it("posts the text and reports delivery on 200", async () => {
    const { calls, fetchImpl } = recorder({ status: 200 });
    const target: AlertTarget = { kind: "webhook", url: WEBHOOK };
    const out = await deliverAlert(target, "reset failed", fetchImpl);

    expect(out.delivered).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(WEBHOOK);
    expect(String(calls[0]?.init?.body)).toContain("[axlepoint reset] reset failed");
    // No Authorization header on a webhook: it is unauthenticated by design.
    expect(calls[0]?.init?.headers).not.toHaveProperty("Authorization");
  });

  it("reports a non-2xx as undelivered", async () => {
    const { fetchImpl } = recorder({ status: 404 });
    const out = await deliverAlert({ kind: "webhook", url: WEBHOOK }, "x", fetchImpl);
    expect(out.delivered).toBe(false);
    expect(out.detail).toContain("did not land");
  });
});

describe("deliverAlert over chat.postMessage", () => {
  const target: AlertTarget = { kind: "slack-bot", token: TOKEN, channel: CHANNEL };

  it("sends the token as a bearer header and the channel in the body", async () => {
    const { calls, fetchImpl } = recorder({ status: 200, body: { ok: true } });
    const out = await deliverAlert(target, "reset failed", fetchImpl);

    expect(out.delivered).toBe(true);
    expect(calls[0]?.url).toBe("https://slack.com/api/chat.postMessage");
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(String(calls[0]?.init?.body)) as { channel: string; text: string };
    expect(body.channel).toBe(CHANNEL);
    expect(body.text).toBe("[axlepoint reset] reset failed");
  });

  // THE CONTROL. Slack refuses with HTTP 200 and ok:false. If this returned
  // delivered:true, every assertion above would still pass and the alerting
  // would be silently dead.
  it("treats HTTP 200 with ok:false as UNDELIVERED and names Slack's error", async () => {
    const { fetchImpl } = recorder({ status: 200, body: { ok: false, error: "invalid_auth" } });
    const out = await deliverAlert(target, "x", fetchImpl);

    expect(out.delivered).toBe(false);
    expect(out.detail).toContain("ok=false");
    expect(out.detail).toContain("invalid_auth");
  });

  it("treats the other common Slack refusals as undelivered too", async () => {
    for (const error of ["channel_not_found", "not_in_channel", "token_revoked"]) {
      const { fetchImpl } = recorder({ status: 200, body: { ok: false, error } });
      const out = await deliverAlert(target, "x", fetchImpl);
      expect(out.delivered).toBe(false);
      expect(out.detail).toContain(error);
    }
  });

  it("treats a 200 with an unparseable body as undelivered", async () => {
    const { fetchImpl } = recorder({ status: 200, bodyIsJson: false });
    const out = await deliverAlert(target, "x", fetchImpl);
    expect(out.delivered).toBe(false);
    expect(out.detail).toContain("not JSON");
  });

  it("treats a 200 with no ok field as undelivered", async () => {
    const { fetchImpl } = recorder({ status: 200, body: { warning: "something" } });
    const out = await deliverAlert(target, "x", fetchImpl);
    expect(out.delivered).toBe(false);
    expect(out.detail).toContain("ok=false");
  });

  it("never puts the token in the reported detail", async () => {
    // The detail string is printed to logs that are not treated as secret.
    for (const response of [
      { status: 200, body: { ok: false, error: "invalid_auth" } },
      { status: 500 },
      { status: 200, bodyIsJson: false as const },
    ]) {
      const { fetchImpl } = recorder(response);
      const out = await deliverAlert(target, "x", fetchImpl);
      expect(out.detail).not.toContain(TOKEN);
      expect(out.detail).not.toContain("xoxb");
    }
  });

  it("reports a thrown transport error instead of throwing", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("getaddrinfo ENOTFOUND slack.com");
    };
    const out = await deliverAlert(target, "x", fetchImpl);
    expect(out.delivered).toBe(false);
    expect(out.detail).toContain("ENOTFOUND");
  });
});

describe("deliverAlert when opted out", () => {
  it("sends nothing and says so", async () => {
    const { calls, fetchImpl } = recorder({ status: 200 });
    const out = await deliverAlert({ kind: "optout" }, "x", fetchImpl);
    expect(out.delivered).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
