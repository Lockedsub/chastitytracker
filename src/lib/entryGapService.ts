import { prisma } from "@/lib/prisma";
import type { Entry, User } from "@prisma/client";
import { validateEntryCreate } from "@/lib/entryCreateService";
import { getKgNeighbors } from "@/lib/queries";
import { entryGuardError, entryGuardCode } from "@/lib/entryErrors";
import type { EntryCreateError } from "@/lib/entryCreateService";
import { boltFieldsFor } from "@/lib/lockPending";

/**
 * Eine vergessene Öffnung samt Wiederverschluss NACHTRAGEN — als EIN Vorgang.
 *
 * Der Anlass: wer sein Logbuch rückwirkend erfasst, vergisst Pausen. Fehlt eine, lässt sie sich
 * über die Einzel-Einträge nicht mehr einfügen — das Öffnen mitten in einer Tragephase hätte einen
 * zweiten OEFFNEN als Nachbarn (`INVALID_ORDER`), der Wiederverschluss einen VERSCHLUSS davor
 * (`ALREADY_LOCKED`), und jeder der beiden Schritte ist ohne den anderen ein Zustand, den die
 * Paarung nicht abbilden kann. Die Ketten-Prüfung ist richtig und bleibt; also geht das Paar in
 * einer Transaktion hinein, und geprüft wird das ENDERGEBNIS der Kette.
 *
 * Bewusst NICHT hier (der Zustand von JETZT bleibt, wie er war — verschlossen vor wie nach dem
 * Nachtrag):
 *   · keine Sperrzeit-Freigabe (`releaseLockPeriodsOnOpen`): eine rückdatierte Pause ist kein
 *     Bruch einer Sperrzeit, die heute gilt;
 *   · keine Erfüllung von Anforderungen und keine Kontrolle nach dem Einschliessen — beide rechnen
 *     ab jetzt und liessen sich von einem Nachtrag aus der Vergangenheit nicht sinnvoll anstossen;
 *   · keine Meldung an die übrigen Kontrolleure: es ist eine Korrektur der Aufzeichnung, kein
 *     Ereignis, auf das jemand reagieren müsste.
 */
export interface EntryGapInput {
  /** Wann der Gürtel geöffnet wurde. */
  openAt: Date;
  /** Wann er wieder verschlossen wurde. Muss nach `openAt` liegen. */
  lockAt: Date;
  oeffnenGrund: string;
  /** Pflicht wie beim Einzel-Öffnen (`NOTE_REQUIRED`). Gilt für das Öffnen. */
  note: string;
}

export type EntryGapResult =
  | { ok: true; opened: Entry; locked: Entry }
  | { ok: false; error: EntryCreateError };

/** Was dem Nachtrag im Weg steht, ohne die Kette zu lesen — oder `null`. SCHREIBFREI; geteilt vom
 *  Dienst (erste Schranke) und der dryRun-Vorschau des MCP, wie `validateEntryCreate`. */
export function validateEntryGap(
  user: Pick<User, "orgasmusArtenConfig" | "oeffnenGruendeConfig">,
  input: EntryGapInput,
  opts: { allowFuture?: boolean } = {},
): EntryCreateError | null {
  if (!(input.openAt < input.lockAt)) return "INVALID_ORDER";
  // Die Prüfungen am Öffnen (Grund, Notiz, Zukunft) sind die des Einzel-Eintrags — dieselbe Quelle.
  const open = validateEntryCreate(user, {
    type: "OEFFNEN", startTime: input.openAt, oeffnenGrund: input.oeffnenGrund, note: input.note,
  }, opts);
  if (open) return open;
  return validateEntryCreate(user, { type: "VERSCHLUSS", startTime: input.lockAt }, opts);
}

export async function createEntryGapForUser(
  user: Pick<User, "id" | "orgasmusArtenConfig" | "oeffnenGruendeConfig">,
  input: EntryGapInput,
  opts: { allowFuture?: boolean } = {},
): Promise<EntryGapResult> {
  const invalid = validateEntryGap(user, input, opts);
  if (invalid) return { ok: false, error: invalid };

  try {
    return await prisma.$transaction(async (tx) => {
      // Der Nachbar VOR dem Öffnen muss ein Verschluss sein — die Pause liegt IN einer Tragephase.
      // `prev` zählt einen exakten Gleichstand mit (`lte`); der Nachtrag verlangt dagegen Abstand,
      // sonst wären Verschluss und Öffnen zeitlich nicht zu unterscheiden.
      const { prev, next } = await getKgNeighbors(user.id, input.openAt, tx);
      if (!prev || prev.type !== "VERSCHLUSS") throw entryGuardError("GAP_NOT_LOCKED");
      if (prev.startTime >= input.openAt) throw entryGuardError("INVALID_ORDER");
      // Der Nachbar DANACH (falls es einen gibt) ist das Öffnen, das die Tragephase beendet. Der
      // Wiederverschluss muss davor liegen, sonst überspränge das Paar einen bestehenden Eintrag.
      if (next && next.startTime <= input.lockAt) throw entryGuardError("INVALID_ORDER");

      const lockDevice = (await tx.entry.findUnique({ where: { id: prev.id }, select: { deviceId: true } }))?.deviceId ?? null;

      const opened = await tx.entry.create({
        data: {
          userId: user.id,
          type: "OEFFNEN",
          startTime: input.openAt,
          oeffnenGrund: input.oeffnenGrund,
          note: input.note.trim(),
        },
      });
      const locked = await tx.entry.create({
        data: {
          userId: user.id,
          type: "VERSCHLUSS",
          startTime: input.lockAt,
          // Dasselbe Gerät wie in der Tragephase, in die das Paar fällt: wer sie unterbrach, hat
          // denselben Gürtel wieder angelegt. Ein anderes Gerät korrigiert `edit_entry`.
          deviceId: lockDevice,
          ...boltFieldsFor("VERSCHLUSS", input.lockAt),
        },
      });
      return { ok: true as const, opened, locked };
    });
  } catch (e: unknown) {
    return { ok: false, error: entryGuardCode(e) };
  }
}
