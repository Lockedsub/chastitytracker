import { lookup } from "dns/promises";
import { BlockList, isIP } from "net";

/**
 * Darf die Foto-Prüfung eine vom ADMIN eingetragene Adresse anfragen?
 *
 * **Warum es das braucht.** Auf einer Portal-Instanz ist der Admin ein fremder Nutzer, nicht der
 * Betreiber des Servers. Der Container hängt dort im selben Docker-Netz wie Portal, Schlüsselbox-
 * Steuerung, MQTT, Traefik und alle anderen Instanzen. Eine frei eintragbare Adresse, an die der
 * Server POST-Anfragen schickt — und deren HTTP-Status „Einstellung testen" zurückmeldet —, wäre ein
 * Werkzeug, dieses Netz abzutasten und anzusprechen.
 *
 * **Die Regel.** Standardmässig nur ÖFFENTLICHE Ziele: kein Loopback, kein privates Netz, kein
 * Link-Local, kein Tailscale-/CGNAT-Bereich, kein einteiliger Hostname (Container-Namen). Aufgelöst
 * wird der Hostname, nicht nur sein Name geprüft — ein öffentlicher Name kann auf eine interne Adresse
 * zeigen. Wer den eigenen Server im lokalen Netz betreibt, schaltet private Ziele ausdrücklich frei:
 * `VISION_ALLOW_PRIVATE_URLS=true`. Das kann nur, wer die `.env` in der Hand hat, also der Betreiber.
 *
 * Gilt nur für Adressen aus der App-Einstellung. Was in der `.env` steht, hat der Betreiber selbst
 * eingetragen.
 */

export function privateVisionUrlsAllowed(): boolean {
  return process.env.VISION_ALLOW_PRIVATE_URLS === "true";
}

const INTERNAL = new BlockList();
// IPv4
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10] /* CGNAT, u.a. Tailscale */, ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 3] /* Multicast und reserviert */,
] as const) INTERNAL.addSubnet(net, prefix, "ipv4");
// IPv6 — ohne die eingebetteten IPv4-Formen (::ffff:0:0/96, 64:ff9b::/96, 2002::/16): die werden unten
// über ihre IPv4-Adresse beurteilt, nicht pauschal.
for (const [net, prefix] of [
  ["::", 96] /* unspezifiziert, Loopback, veraltet IPv4-kompatibel */, ["100::", 64], ["2001::", 32] /* Teredo */,
  ["2001:db8::", 32], ["64:ff9b:1::", 48], ["fc00::", 7] /* ULA */, ["fe80::", 10] /* Link-Local */,
  ["fec0::", 10], ["ff00::", 8],
] as const) INTERNAL.addSubnet(net, prefix, "ipv6");

/** Die 16 Bytes einer IPv6-Adresse (inkl. `::` und angehängter IPv4-Schreibweise), sonst null. */
function ipv6Bytes(ip: string): number[] | null {
  let text = ip;
  const dotted = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(2).map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return null;
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const groups = (h: string) => (h === "" ? [] : h.split(":"));
  const head = groups(halves[0]);
  const tail = halves.length === 2 ? groups(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  const bytes: number[] = [];
  for (const g of all) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push(n >> 8, n & 255);
  }
  return bytes;
}

/** Die IPv4-Adresse, die eine IPv6-Adresse nur trägt (IPv4-mapped, NAT64, 6to4) — sonst null. */
function embeddedIPv4(b: number[]): string | null {
  const zeros = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  const v4 = (at: number) => b.slice(at, at + 4).join(".");
  if (zeros(0, 10) && b[10] === 0xff && b[11] === 0xff) return v4(12); // ::ffff:0:0/96
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zeros(4, 12)) return v4(12); // 64:ff9b::/96
  if (b[0] === 0x20 && b[1] === 0x02) return v4(2); // 2002::/16
  return null;
}

/**
 * Liegt die IP-Adresse in einem nicht-öffentlichen Bereich? Ein Nicht-IP-Wert gilt als intern.
 *
 * Ausgewertet wird über `net.BlockList` und die Bytes der Adresse, NICHT über ihre Schreibweise: die
 * WHATWG-URL normalisiert `http://[::ffff:127.0.0.1]/` zu `::ffff:7f00:1`, und eine Prüfung auf die
 * gepunktete Form liess genau diese durch. Dasselbe gilt für NAT64 (`64:ff9b::7f00:1`) und 6to4
 * (`2002:7f00:1::`): sie tragen eine IPv4-Adresse, und DIE entscheidet.
 */
export function isInternalAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return INTERNAL.check(ip, "ipv4");
  if (family === 6) {
    if (ip.includes("%")) return true; // Zonenangabe: nur lokal sinnvoll
    const bytes = ipv6Bytes(ip);
    if (!bytes) return true;
    const v4 = embeddedIPv4(bytes);
    if (v4) return INTERNAL.check(v4, "ipv4");
    return INTERNAL.check(ip, "ipv6");
  }
  return true;
}

export interface VisionTarget {
  /** Die geprüfte Adresse — GENAU an sie verbindet `pinnedFetch`. */
  address: string;
  family: 4 | 6;
}

/**
 * Löst eine Adresse zu dem EINEN Ziel auf, an das verbunden werden darf — oder null.
 *
 * Wer nur prüft und danach `fetch(url)` ruft, löst den Namen zweimal auf; ein Angreifer-DNS mit
 * kurzer TTL antwortet beim Prüfen öffentlich und beim Verbinden intern (DNS-Rebinding).
 * `pinnedFetch` benutzt deshalb DIESES Ergebnis zum Verbinden. Wirft nie.
 */
export async function resolveVisionTarget(raw: string): Promise<VisionTarget | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const open = privateVisionUrlsAllowed();
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(host);
  if (family) return open || !isInternalAddress(host) ? { address: host, family: family as 4 | 6 } : null;
  // Einteilig heisst: ein Name im Docker-Netz (`heimdall`, `tracker-portal`) oder `localhost`.
  if (!open && !host.includes(".")) return null;
  try {
    const addresses = await lookup(host, { all: true });
    if (addresses.length === 0) return null;
    if (!open && !addresses.every((a) => !isInternalAddress(a.address))) return null;
    return { address: addresses[0].address, family: addresses[0].family as 4 | 6 };
  } catch {
    return null;
  }
}

/** Ist die Adresse ein erlaubtes Ziel? Wirft nie. */
export async function isAllowedVisionUrl(raw: string): Promise<boolean> {
  return (await resolveVisionTarget(raw)) !== null;
}
