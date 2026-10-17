import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from "vitest";
import http from "http";
import type { AddressInfo } from "net";

const lookup = vi.fn();
vi.mock("dns/promises", () => ({ lookup: (...a: unknown[]) => lookup(...a) }));

import { pinnedFetch } from "./pinnedFetch";

let server: http.Server;
let port: number;
let seenHost = "";
let seenBody = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seenHost = req.headers.host ?? "";
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "http://169.254.169.254/" }).end();
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seenBody = body;
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => server.close());
afterEach(() => {
  delete process.env.VISION_ALLOW_PRIVATE_URLS;
  lookup.mockReset();
});

describe("pinnedFetch", () => {
  it("verbindet an die EINMAL geprüfte Adresse — der Name wird nicht ein zweites Mal aufgelöst", async () => {
    process.env.VISION_ALLOW_PRIVATE_URLS = "true";
    lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const res = await pinnedFetch(`http://pinned.example.test:${port}/x`, { method: "POST", body: '{"a":1}', headers: { "Content-Type": "application/json" } });
    expect(await res.json()).toEqual({ ok: true });
    expect(seenHost).toBe(`pinned.example.test:${port}`);
    expect(seenBody).toBe('{"a":1}');
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("probiert alle geprüften Adressen durch — der Dienst hört oft nur auf einer von ::1 / 127.0.0.1", async () => {
    process.env.VISION_ALLOW_PRIVATE_URLS = "true";
    lookup.mockResolvedValue([{ address: "::1", family: 6 }, { address: "127.0.0.1", family: 4 }]);
    const res = await pinnedFetch(`http://dual.example.test:${port}/x`);
    expect(res.status).toBe(200);
  });

  it("verweigert ein Ziel, das auf eine interne Adresse zeigt", async () => {
    lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(pinnedFetch(`http://rebind.example.test:${port}/x`)).rejects.toThrow("not allowed");
    await expect(pinnedFetch(`http://[::ffff:7f00:1]:${port}/x`)).rejects.toThrow("not allowed");
  });

  it("folgt keiner Weiterleitung", async () => {
    process.env.VISION_ALLOW_PRIVATE_URLS = "true";
    await expect(pinnedFetch(`http://127.0.0.1:${port}/redirect`)).rejects.toThrow("redirected");
  });
});
