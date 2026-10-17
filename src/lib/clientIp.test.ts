import { describe, it, expect } from "vitest";
import { clientIp, clientIpFromHeaders } from "./clientIp";

const h = (o: Record<string, string>) => new Headers(o);

describe("clientIp", () => {
  it("nimmt den LETZTEN Eintrag von X-Forwarded-For — den Traefik angehängt hat", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" }))).toBe("1.2.3.4");
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "1.2.3.4" }))).toBe("1.2.3.4");
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "6.6.6.6,  1.2.3.4 " }))).toBe("1.2.3.4");
  });

  it("fällt auf x-real-ip, dann auf 'unknown' zurück", () => {
    expect(clientIpFromHeaders(h({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIpFromHeaders(h({}))).toBe("unknown");
  });

  it("ein leerer Header ist kein Wert", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "", "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIpFromHeaders(h({ "x-forwarded-for": " " }))).toBe("unknown");
  });

  it("liest aus einer Anfrage", () => {
    expect(clientIp(new Request("http://x/", { headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" } }))).toBe("2.2.2.2");
  });
});
