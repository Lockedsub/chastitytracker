import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";

/**
 * Muster, die in diesem Baum nichts zu suchen haben — als Dateiscan, weil jede dieser Regeln
 * schon einmal in CLAUDE.md stand und trotzdem übersehen werden kann. Bauart nach
 * `nestedComponents.test.ts`: den Baum lesen statt eine Dateiliste pflegen, vor dem Vergleich die
 * Kommentare entfernen (die Begründungen nennen die gesuchten Muster selbst).
 *
 * Eine Ausnahme gehört in die Liste unten, MIT Begründung — nicht in eine Aufweichung des Musters.
 */
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const SRC = readdirSync("src", { recursive: true, encoding: "utf8" })
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => `src/${f}`)
  .sort();

const read = (f: string) => strip(readFileSync(f, "utf8"));

function scan(files: string[], re: RegExp, allow: Record<string, string> = {}): string[] {
  const hits: string[] = [];
  for (const f of files) {
    if (f in allow) continue;
    const src = read(f);
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      if (re.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

describe("verbotene Muster", () => {
  it("findet den Baum — sonst prüft der Test nichts", () => {
    expect(SRC.length).toBeGreaterThan(300);
  });

  it("keine synchronen FS-/Prozess-Aufrufe in den API-Routen (blockieren den Event-Loop)", () => {
    // `\b…\b` mit der vollen Namensliste: `requireBoxSync(` ist KEIN Treffer.
    const SYNC = /\b(readFileSync|writeFileSync|appendFileSync|rmSync|rmdirSync|unlinkSync|mkdirSync|readdirSync|statSync|lstatSync|existsSync|copyFileSync|renameSync|execSync|execFileSync|spawnSync)\b/;
    expect(scan(SRC.filter((f) => f.startsWith("src/app/api/")), SYNC)).toEqual([]);
  });

  it("kein require() — ES-Imports", () => {
    expect(scan(SRC, /(^|[^.\w])require\(/)).toEqual([]);
  });

  it("X-Forwarded-For und X-Real-IP werden nur im IP-Helfer gelesen", () => {
    // Der erste Eintrag von X-Forwarded-For ist vom Aufrufer wählbar (Traefik hängt die echte IP ans
    // ENDE) — jede zweite Kopie der Auslese ist eine Stelle, an der das wieder falsch werden kann.
    const allow = { "src/lib/clientIp.ts": "der EINE Helfer" };
    expect(scan(SRC, /x-forwarded-for|x-real-ip/i, allow)).toEqual([]);
  });

  it("kein Math.random() dort, wo es um Anmeldung, Sitzungen und Tokens geht", () => {
    const SECURITY = SRC.filter((f) =>
      /^src\/lib\/(auth|login-attempts|loginIdentity|oauth|webauthn|secretBox|passwordAudit|boxSync)/.test(f) ||
      f.startsWith("src/app/api/oauth/") || f.startsWith("src/app/api/auth/") || f.startsWith("src/app/api/portal-login/"),
    );
    expect(SECURITY.length).toBeGreaterThan(5);
    expect(scan(SECURITY, /Math\.random\(/)).toEqual([]);
  });

  it("die Auth-Endpunkte ohne Session sind rate-limitiert", () => {
    // Genau die, die das Proxy-Gate durchlässt (`publicRoutes.ts`) und die für Fremde etwas tun.
    const LIMITED = [
      "src/app/api/auth/forgot-password/route.ts",
      "src/app/api/auth/reset-password/route.ts",
      "src/app/api/auth/lockout/route.ts",
      "src/app/api/auth/passkey/authenticate/route.ts",
      "src/app/api/oauth/register/route.ts",
      "src/app/api/oauth/revoke/route.ts",
      "src/app/api/oauth/token/route.ts",
    ];
    expect(LIMITED.filter((f) => !/checkRateLimit\(/.test(read(f)))).toEqual([]);
  });
});
