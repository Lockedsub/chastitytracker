import { readdirSync, readFileSync } from "node:fs";

/**
 * TEST-ONLY — Bausteine für Wächter-Tests, die den Quelltext lesen (`routeInventory`,
 * `forbiddenPatterns`, `imageUrlValidation`): Kommentare entfernen, Dateien auflisten, gestrippt
 * lesen. Gelesen wird je Datei EINMAL, auch wenn mehrere Tests sie brauchen.
 *
 * Das Entfernen ist bewusst grob: die Begründungen im Baum nennen die gesuchten Muster selbst, und
 * die Ausnahme `[^:]` rettet `https://…`. Ein `//` in einem String-Literal wird mit abgeschnitten —
 * für die Muster hier unschädlich, für ein neues Muster mitbedenken.
 */
export const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Alle Dateien unter `root` (rekursiv), die `pred` für den relativen Namen bejaht — sortiert, mit Präfix `root/`. */
export function listFiles(root: string, pred: (relative: string) => boolean): string[] {
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter(pred)
    .map((f) => `${root}/${f}`)
    .sort();
}

const cache = new Map<string, string>();

/** Der Quelltext ohne Kommentare, je Datei einmal gelesen. */
export function readStripped(file: string): string {
  let src = cache.get(file);
  if (src === undefined) {
    src = stripComments(readFileSync(file, "utf8"));
    cache.set(file, src);
  }
  return src;
}
