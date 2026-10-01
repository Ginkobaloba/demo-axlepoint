/**
 * Where a failed demo reset tells a human, and how it knows the telling landed.
 *
 * Two transports, and they are NOT interchangeable -- which is why this module
 * exists. A Slack incoming webhook is a bare URL that takes an unauthenticated
 * `{text}` POST. Slack's chat.postMessage takes a bot token in an Authorization
 * header and a channel id in the body. The reset script accepted only the first;
 * the credential that exists on the deploy host is only the second.
 *
 * WHY THE BOT TOKEN IS THE WIDER CREDENTIAL, recorded because the choice was
 * made with this in front of the decider. A leaked webhook URL can post to the
 * one channel it was created for. A leaked bot token can post as the bot
 * anywhere the bot is a member and, with the scopes this one already carries,
 * read channel history. Drew chose the bot token on 2026-10-01 to avoid a
 * Slack-admin step. Mitigating what can be mitigated inside that choice means:
 * never log the token, never put it in an error string, keep it out of the
 * repository. A dedicated chat:write-only token would be the real mitigation
 * and cannot be minted without him.
 *
 * THE FAILURE THIS MODULE EXISTS TO PREVENT. chat.postMessage answers HTTP 200
 * with a body of {"ok": false, "error": "invalid_auth"} when it refuses.
 * Checking the HTTP status -- correct for a webhook, and what the webhook path
 * has always done -- would report a delivered alert for a revoked token, a bad
 * channel id, or a bot that was removed from the channel. A false pass anywhere
 * is bad; a false pass in the alerting path is the worst one available, because
 * this code's whole job is to be the thing that speaks up when something else
 * went wrong. So the bot path requires body.ok === true and reports Slack's own
 * error code when it is not.
 */

export const ALERT_OPTOUT = "i-will-not-be-told-about-failures";

const SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";

export type AlertTarget =
  | { kind: "webhook"; url: string }
  | { kind: "slack-bot"; token: string; channel: string }
  | { kind: "optout" };

export interface AlertTargetResolution {
  /** Null when the environment does not name a usable destination. */
  target: AlertTarget | null;
  /** Operator-facing reason, already formatted, when `target` is null. */
  error: string | null;
  /** Non-fatal notes worth printing. Never contains a credential. */
  warnings: string[];
}

/**
 * The variables this reads, named for documentation. The index signature is
 * what makes `process.env` (a ProcessEnv, which is an index signature) directly
 * assignable; without it TypeScript reports no properties in common.
 */
export interface AlertEnv {
  readonly RESET_ALERT_WEBHOOK?: string | undefined;
  readonly RESET_ALERT_SLACK_TOKEN?: string | undefined;
  readonly RESET_ALERT_SLACK_CHANNEL?: string | undefined;
  readonly RESET_ALERT_OPTOUT?: string | undefined;
  readonly [key: string]: string | undefined;
}

const NO_DESTINATION =
  "No alert destination is configured.\n" +
  "  A reset that fails silently is worse than one that does not run: the\n" +
  "  demo keeps serving visitor data past its retention window while every\n" +
  "  dashboard looks fine. Point it at somewhere a human actually reads.\n" +
  "  Either RESET_ALERT_WEBHOOK=https://hooks.slack.com/...\n" +
  "  or RESET_ALERT_SLACK_TOKEN with RESET_ALERT_SLACK_CHANNEL=<channel id>.\n" +
  `  To run without alerting anyway: RESET_ALERT_OPTOUT=${ALERT_OPTOUT}`;

function trimmed(value: string | undefined): string {
  return (value ?? "").trim();
}

/**
 * Decides the destination from the environment, refusing anything ambiguous.
 *
 * A HALF-SET bot credential is an error, not a fallthrough to "no destination".
 * Token-without-channel is exactly the shape an operator produces midway
 * through setting this up, and treating it as absence would turn a typo into a
 * silent loss of alerting -- the precise failure the refusal is here to prevent.
 */
export function resolveAlertTarget(env: AlertEnv): AlertTargetResolution {
  const webhook = trimmed(env.RESET_ALERT_WEBHOOK);
  const token = trimmed(env.RESET_ALERT_SLACK_TOKEN);
  const channel = trimmed(env.RESET_ALERT_SLACK_CHANNEL);
  const warnings: string[] = [];

  if (token && !channel) {
    return {
      target: null,
      warnings,
      error:
        "RESET_ALERT_SLACK_TOKEN is set but RESET_ALERT_SLACK_CHANNEL is not.\n" +
        "  chat.postMessage needs a channel id; a token alone names no destination.\n" +
        "  Refusing rather than treating a half-configured alert as no alert.",
    };
  }
  if (channel && !token) {
    return {
      target: null,
      warnings,
      error:
        "RESET_ALERT_SLACK_CHANNEL is set but RESET_ALERT_SLACK_TOKEN is not.\n" +
        "  Refusing rather than treating a half-configured alert as no alert.",
    };
  }

  if (webhook && token) {
    // Both transports configured. Prefer the webhook: it is the narrower
    // credential, and it is what this script accepted before the bot path
    // existed, so an operator who sets both gets the safer one.
    warnings.push(
      "Both RESET_ALERT_WEBHOOK and RESET_ALERT_SLACK_TOKEN are set; using the " +
        "webhook, which is the narrower credential.",
    );
  }

  if (webhook) return { target: { kind: "webhook", url: webhook }, error: null, warnings };
  if (token && channel) {
    return { target: { kind: "slack-bot", token, channel }, error: null, warnings };
  }
  if (trimmed(env.RESET_ALERT_OPTOUT) === ALERT_OPTOUT) {
    return { target: { kind: "optout" }, error: null, warnings };
  }
  return { target: null, error: NO_DESTINATION, warnings };
}

export interface Delivery {
  delivered: boolean;
  /** Safe to print. Never contains the token. */
  detail: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Sends one alert. Never throws: a delivery problem must be reported, not
 * raised into the caller's own failure handling.
 */
export async function deliverAlert(
  target: AlertTarget,
  message: string,
  fetchImpl: FetchLike,
): Promise<Delivery> {
  if (target.kind === "optout") {
    return { delivered: false, detail: "no destination configured (opted out)" };
  }
  const text = `[axlepoint reset] ${message}`;

  try {
    if (target.kind === "webhook") {
      const res = await fetchImpl(target.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      // An incoming webhook signals refusal with the HTTP status, so here the
      // status is the whole answer.
      return res.ok
        ? { delivered: true, detail: `webhook HTTP ${res.status}` }
        : { delivered: false, detail: `webhook HTTP ${res.status}; the message did not land` };
    }

    const res = await fetchImpl(SLACK_POST_MESSAGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${target.token}`,
      },
      body: JSON.stringify({ channel: target.channel, text }),
    });

    // HTTP 200 is necessary and NOT sufficient. See the module docstring.
    if (!res.ok) {
      return {
        delivered: false,
        detail: `chat.postMessage HTTP ${res.status}; the message did not land`,
      };
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return {
        delivered: false,
        detail:
          "chat.postMessage returned HTTP 200 with a body that is not JSON; treating as undelivered",
      };
    }
    const ok =
      typeof body === "object" && body !== null && (body as { ok?: unknown }).ok === true;
    if (!ok) {
      const slackError =
        typeof body === "object" &&
        body !== null &&
        typeof (body as { error?: unknown }).error === "string"
          ? (body as { error: string }).error
          : "unknown";
      // Slack's error strings are codes -- invalid_auth, channel_not_found,
      // not_in_channel. They never echo the token.
      return {
        delivered: false,
        detail: `chat.postMessage returned HTTP 200 but ok=false (${slackError}); the message did not land`,
      };
    }
    return { delivered: true, detail: "chat.postMessage ok" };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { delivered: false, detail: `alert transport failed: ${reason}` };
  }
}
