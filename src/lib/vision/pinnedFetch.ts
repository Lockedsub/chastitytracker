import http from "http";
import https from "https";
import { resolveVisionTarget } from "./urlGuard";

/**
 * `fetch` für Adressen aus der App-Einstellung: prüft das Ziel UND verbindet genau an die geprüfte
 * Adresse. Der Name wird nur EINMAL aufgelöst (`resolveVisionTarget`); das `lookup` der Verbindung
 * liefert dieses Ergebnis, statt DNS erneut zu fragen — damit ist DNS-Rebinding zwischen Prüfung und
 * Verbindung ausgeschlossen. TLS prüft weiter gegen den Hostnamen (SNI/Zertifikat), nicht gegen die IP.
 *
 * Bewusst klein: nur String-Bodies, keine Weiterleitungen (eine 3xx ist ein Fehler — sie könnte auf
 * ein internes Ziel zeigen), die Antwort wird vollständig gelesen. Die Vision-Antworten sind kleine JSON.
 * Das globale `fetch` lässt sich nicht an eine Adresse binden, ohne `undici` als Abhängigkeit zu führen.
 */
export async function pinnedFetch(rawUrl: string, init: RequestInit = {}): Promise<Response> {
  const target = await resolveVisionTarget(rawUrl);
  if (!target) throw new Error("vision target not allowed");
  const url = new URL(rawUrl);
  const body = init.body;
  if (body != null && typeof body !== "string") throw new Error("pinnedFetch: only string bodies");

  const headers = Object.fromEntries(new Headers(init.headers).entries());
  if (body != null) headers["content-length"] = String(Buffer.byteLength(body));
  const transport = url.protocol === "https:" ? https : http;

  return new Promise<Response>((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: init.method ?? "GET",
        headers,
        signal: init.signal ?? undefined,
        lookup: ((_host: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) =>
          opts?.all ? cb(null, target.addresses) : cb(null, target.addresses[0].address, target.addresses[0].family)) as never,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          reject(new Error("vision target redirected"));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("error", reject);
        res.on("end", () => {
          const out = new Headers();
          for (const [k, v] of Object.entries(res.headers)) for (const one of Array.isArray(v) ? v : v == null ? [] : [v]) out.append(k, one);
          resolve(new Response(status === 204 || status === 205 ? null : Buffer.concat(chunks), { status, statusText: res.statusMessage, headers: out }));
        });
      },
    );
    req.on("error", reject);
    req.end(body ?? undefined);
  });
}
