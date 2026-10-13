import { describe, it, expect, vi, beforeEach } from "vitest";

const tx = {
  entry: { findUnique: vi.fn(), create: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) },
}));
vi.mock("@/lib/queries", () => ({ getKgNeighbors: vi.fn() }));

import { createEntryGapForUser, validateEntryGap } from "./entryGapService";
import { getKgNeighbors } from "@/lib/queries";

const neighbors = getKgNeighbors as unknown as ReturnType<typeof vi.fn>;
const USER = { id: "u1", orgasmusArtenConfig: null, oeffnenGruendeConfig: null };
const at = (h: number) => new Date(Date.UTC(2026, 9, 1, h));
const INPUT = { openAt: at(10), lockAt: at(12), oeffnenGrund: "KEYHOLDER", note: "vergessen" };

beforeEach(() => {
  vi.clearAllMocks();
  tx.entry.findUnique.mockResolvedValue({ deviceId: "d1" });
  tx.entry.create.mockImplementation(async ({ data }: { data: object }) => ({ id: "x", ...data }));
});

describe("createEntryGapForUser", () => {
  it("schreibt Öffnen und Wiederverschluss, Gerät vom umgebenden Verschluss", async () => {
    neighbors.mockResolvedValue({ prev: { id: "p", type: "VERSCHLUSS", startTime: at(8) }, next: { id: "n", type: "OEFFNEN", startTime: at(20) } });
    const res = await createEntryGapForUser(USER, INPUT);
    expect(res.ok).toBe(true);
    const [open, lock] = tx.entry.create.mock.calls.map((c) => c[0].data);
    expect(open).toMatchObject({ type: "OEFFNEN", startTime: INPUT.openAt, oeffnenGrund: "KEYHOLDER" });
    expect(lock).toMatchObject({ type: "VERSCHLUSS", startTime: INPUT.lockAt, deviceId: "d1", boltConfirmedAt: INPUT.lockAt });
  });

  it("erlaubt die laufende Tragephase (kein Nachbar danach)", async () => {
    neighbors.mockResolvedValue({ prev: { id: "p", type: "VERSCHLUSS", startTime: at(8) }, next: null });
    expect((await createEntryGapForUser(USER, INPUT)).ok).toBe(true);
  });

  it("lehnt ab, wenn der Träger zum Öffnungszeitpunkt nicht verschlossen war", async () => {
    neighbors.mockResolvedValue({ prev: { id: "p", type: "OEFFNEN", startTime: at(8) }, next: null });
    expect(await createEntryGapForUser(USER, INPUT)).toEqual({ ok: false, error: "GAP_NOT_LOCKED" });
    neighbors.mockResolvedValue({ prev: null, next: null });
    expect(await createEntryGapForUser(USER, INPUT)).toEqual({ ok: false, error: "GAP_NOT_LOCKED" });
    expect(tx.entry.create).not.toHaveBeenCalled();
  });

  it("lehnt ab, wenn das Paar über das nächste bestehende Öffnen hinausreicht", async () => {
    neighbors.mockResolvedValue({ prev: { id: "p", type: "VERSCHLUSS", startTime: at(8) }, next: { id: "n", type: "OEFFNEN", startTime: at(11) } });
    expect(await createEntryGapForUser(USER, INPUT)).toEqual({ ok: false, error: "INVALID_ORDER" });
  });

  it("verlangt Abstand zum vorherigen Verschluss", async () => {
    neighbors.mockResolvedValue({ prev: { id: "p", type: "VERSCHLUSS", startTime: at(10) }, next: null });
    expect(await createEntryGapForUser(USER, INPUT)).toEqual({ ok: false, error: "INVALID_ORDER" });
  });
});

describe("validateEntryGap", () => {
  it("Öffnen muss vor dem Wiederverschluss liegen", () => {
    expect(validateEntryGap(USER, { ...INPUT, openAt: at(12), lockAt: at(10) })).toBe("INVALID_ORDER");
  });
  it("verlangt Notiz und Grund wie das Einzel-Öffnen", () => {
    expect(validateEntryGap(USER, { ...INPUT, note: " " })).toBe("NOTE_REQUIRED");
    expect(validateEntryGap(USER, { ...INPUT, oeffnenGrund: "" })).toBe("OPENING_REASON_REQUIRED");
  });
  it("lehnt die Zukunft ab", () => {
    const far = new Date(Date.now() + 3_600_000);
    expect(validateEntryGap(USER, { ...INPUT, openAt: new Date(Date.now() - 1000), lockAt: far })).toBe("TIME_IN_FUTURE");
  });
});

describe("entryGapEnabled", () => {
  it("ist ohne ALLOW_ENTRY_GAP aus", async () => {
    const { entryGapEnabled } = await import("./entryGapService");
    delete process.env.ALLOW_ENTRY_GAP;
    expect(entryGapEnabled()).toBe(false);
    process.env.ALLOW_ENTRY_GAP = "true";
    expect(entryGapEnabled()).toBe(true);
    delete process.env.ALLOW_ENTRY_GAP;
  });
});
