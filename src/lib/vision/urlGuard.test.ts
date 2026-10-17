import { describe, it, expect, afterEach, vi } from "vitest";

const lookup = vi.fn();
vi.mock("dns/promises", () => ({ lookup: (...a: unknown[]) => lookup(...a) }));

import { isAllowedVisionUrl, isInternalAddress } from "./urlGuard";

afterEach(() => {
  delete process.env.VISION_ALLOW_PRIVATE_URLS;
  lookup.mockReset();
});

describe("isInternalAddress", () => {
  it("erkennt die internen IPv4-Bereiche — auch den Tailscale-Bereich", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.18.0.24", "192.168.1.5", "169.254.1.1", "100.100.1.1", "0.0.0.0"]) {
      expect(isInternalAddress(ip)).toBe(true);
    }
    for (const ip of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "93.184.216.34"]) {
      expect(isInternalAddress(ip)).toBe(false);
    }
  });

  it("erkennt interne IPv6-Adressen samt eingebettetem IPv4", () => {
    for (const ip of ["::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) expect(isInternalAddress(ip)).toBe(true);
    expect(isInternalAddress("2606:4700::1111")).toBe(false);
  });
});

describe("isInternalAddress — Umgehungsvarianten", () => {
  it("IPv4-mapped IPv6 in jeder Schreibweise (die URL normalisiert auf Hex)", () => {
    expect(new URL("http://[::ffff:127.0.0.1]/").hostname).toBe("[::ffff:7f00:1]");
    for (const ip of ["::ffff:7f00:1", "::ffff:127.0.0.1", "0:0:0:0:0:ffff:7f00:1", "::FFFF:A00:1", "::ffff:c0a8:101", "::ffff:ac12:1805", "::ffff:a9fe:a9fe"]) {
      expect(isInternalAddress(ip), ip).toBe(true);
    }
    expect(isInternalAddress("::ffff:808:808")).toBe(false); // 8.8.8.8 — nur getarnt, nicht intern
  });

  it("NAT64 und 6to4 tragen eine IPv4-Adresse, und die entscheidet", () => {
    for (const ip of ["64:ff9b::7f00:1", "64:ff9b::a00:1", "64:ff9b::127.0.0.1", "2002:7f00:1::", "2002:a00:1::1", "2002:c0a8:101::"]) {
      expect(isInternalAddress(ip), ip).toBe(true);
    }
    expect(isInternalAddress("64:ff9b::808:808")).toBe(false);
    expect(isInternalAddress("2002:808:808::")).toBe(false);
    expect(isInternalAddress("64:ff9b:1::1")).toBe(true); // lokal nutzbarer NAT64-Bereich
  });

  it("Loopback, unspezifiziert, Link-Local, ULA, Multicast, Teredo, Dokumentation", () => {
    for (const ip of ["::", "::1", "0:0:0:0:0:0:0:1", "::7f00:1", "fe80::1", "febf::1", "fc00::1", "fdff::1", "ff02::1", "2001::1", "2001:db8::1", "100::1", "fec0::1"]) {
      expect(isInternalAddress(ip), ip).toBe(true);
    }
    expect(isInternalAddress("fe80::1%eth0")).toBe(true);
  });

  it("weitere IPv4-Bereiche und Randwerte", () => {
    for (const ip of ["192.0.0.1", "192.0.2.1", "198.18.0.1", "198.19.255.255", "203.0.113.9", "224.0.0.1", "255.255.255.255", "172.16.0.0", "172.31.255.255"]) {
      expect(isInternalAddress(ip), ip).toBe(true);
    }
    for (const ip of ["172.15.255.255", "172.32.0.0", "100.63.255.255", "100.128.0.0", "198.17.255.255", "198.20.0.0", "223.255.255.255"]) {
      expect(isInternalAddress(ip), ip).toBe(false);
    }
  });

  it("öffentliche IPv6-Adressen bleiben erlaubt; Nicht-IP und Kaputtes gelten als intern", () => {
    for (const ip of ["2606:4700:4700::1111", "2a00:1450:4001:81b::200e"]) expect(isInternalAddress(ip), ip).toBe(false);
    for (const ip of ["", "localhost", "example.org", "1:2:3", "::g", "1::2::3", "::ffff:999.1.1.1"]) expect(isInternalAddress(ip), ip).toBe(true);
  });
});

describe("isAllowedVisionUrl — Adress-Schreibweisen in der URL", () => {
  it("sperrt die Varianten, in denen eine interne Adresse getarnt ist", async () => {
    for (const u of [
      "http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]:11434/v1", "http://[::1]/", "http://[64:ff9b::7f00:1]/", "http://[2002:7f00:1::]/",
      "http://2130706433/", "http://0x7f.0.0.1/", "http://0177.0.0.1/", "http://127.1/", "http://127.0.0.1.:80/",
      "ftp://93.184.216.34/", "file:///etc/passwd", "javascript:alert(1)", "not a url",
    ]) {
      expect(await isAllowedVisionUrl(u), u).toBe(false);
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it("erlaubt eine öffentliche IP-Adresse", async () => {
    expect(await isAllowedVisionUrl("https://93.184.216.34/v1")).toBe(true);
    expect(await isAllowedVisionUrl("https://[2606:4700:4700::1111]/v1")).toBe(true);
  });

  it("ein Name, der auch NUR EINE interne Adresse trägt, ist gesperrt (Rebinding-Mischantwort)", async () => {
    lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }, { address: "::ffff:7f00:1", family: 6 }]);
    expect(await isAllowedVisionUrl("https://mixed.example.org/v1")).toBe(false);
  });
});

describe("isAllowedVisionUrl", () => {
  it("sperrt Container-Namen und interne Adressen — genau das Docker-Netz einer Portal-Instanz", async () => {
    expect(await isAllowedVisionUrl("http://heimdall:8080/api")).toBe(false);
    expect(await isAllowedVisionUrl("http://tracker-portal:3000")).toBe(false);
    expect(await isAllowedVisionUrl("http://localhost:11434/v1")).toBe(false);
    expect(await isAllowedVisionUrl("http://172.18.0.5:3000")).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("löst den Hostnamen auf: ein öffentlicher Name mit interner Adresse ist gesperrt", async () => {
    lookup.mockResolvedValueOnce([{ address: "10.0.0.7", family: 4 }]);
    expect(await isAllowedVisionUrl("https://sneaky.example.org/v1")).toBe(false);
    lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    expect(await isAllowedVisionUrl("https://ai.example.org/v1")).toBe(true);
  });

  it("ein nicht auflösbarer Name ist kein erlaubtes Ziel", async () => {
    lookup.mockRejectedValueOnce(new Error("ENOTFOUND"));
    expect(await isAllowedVisionUrl("https://gibtsnicht.example.org/v1")).toBe(false);
  });

  it("der Betreiber kann private Ziele ausdrücklich freigeben", async () => {
    process.env.VISION_ALLOW_PRIVATE_URLS = "true";
    expect(await isAllowedVisionUrl("http://192.168.1.5:11434/v1")).toBe(true);
  });
});
