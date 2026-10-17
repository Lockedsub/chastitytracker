import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Push-Zustellung: Zeitlimits und der Weg über native Tokens.
 *
 * Echte Dienste (APNs, FCM, Push-Endpunkte) sind hier nicht erreichbar und sollen es nicht sein: es
 * wird geprüft, WAS die Zustellung an sie schickt (Zeitlimit, Signal), nicht ob sie antworten.
 */
const { sendNotification, nativeTokens, subscriptions, deleteTokens } = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  nativeTokens: vi.fn(),
  subscriptions: vi.fn(),
  deleteTokens: vi.fn(),
}));

vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification } }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    nativePushToken: { findMany: nativeTokens, deleteMany: deleteTokens },
    pushSubscription: { findMany: subscriptions, deleteMany: vi.fn() },
  },
}));
vi.mock("@/lib/pushEndpoint", () => ({ isAllowedPushEndpoint: () => true }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
  vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
  vi.stubEnv("FCM_SERVER_KEY", "fcm-key");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Zeitlimits", () => {
  it("FCM: der fetch trägt ein AbortSignal", async () => {
    nativeTokens.mockResolvedValue([{ id: "t1", platform: "android", token: "tok" }]);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [{}] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { sendPushToUser } = await import("./push");
    await sendPushToUser("u1", "Titel", "Text", "/x");
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("Web-Push: sendNotification bekommt ein Zeitlimit", async () => {
    nativeTokens.mockResolvedValue([]);
    subscriptions.mockResolvedValue([{ id: "s1", endpoint: "https://push.example/x", p256dh: "k", auth: "a" }]);
    sendNotification.mockResolvedValue({});
    const { sendPushToUser } = await import("./push");
    await sendPushToUser("u1", "Titel", "Text");
    expect(sendNotification).toHaveBeenCalledOnce();
    const opts = sendNotification.mock.calls[0][2] as { timeout?: number };
    expect(opts.timeout).toBe(10_000);
  });
});
