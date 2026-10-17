import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `processDueOrgasmusAnforderungen` — der Poller-Pfad, der eine terminierte Orgasmus-Anweisung zustellt.
 *
 * Zwischen dem Lesen der fälligen Zeilen und dem Versand kann die Keyholderin die Anweisung
 * zurückziehen. Das abschliessende `update` auf die id prüfte `withdrawnAt` nicht: die Mail ging an
 * den Träger, und der Stempel schrieb die Zeile zurück in den Zustand „zugestellt" — für eine
 * Anweisung, die es nicht mehr gibt. Jetzt wird die Zeile ZUERST mit Zustandsbedingung beansprucht
 * (wie `dispatchDueTasks`), und nur wer sie bekommt, benachrichtigt.
 */
vi.mock("@/lib/prisma", () => ({
  prisma: { orgasmusAnforderung: { findMany: vi.fn(), updateMany: vi.fn() } },
}));
vi.mock("@/lib/orgasmusAnforderungService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/orgasmusAnforderungService")>();
  return { ...actual, sendOrgasmusAnforderungNotifications: vi.fn() };
});

import { processDueOrgasmusAnforderungen } from "./kontrollePoller";
import { prisma } from "@/lib/prisma";
import { sendOrgasmusAnforderungNotifications } from "@/lib/orgasmusAnforderungService";

const findMany = prisma.orgasmusAnforderung.findMany as unknown as ReturnType<typeof vi.fn>;
const updateMany = prisma.orgasmusAnforderung.updateMany as unknown as ReturnType<typeof vi.fn>;
const send = sendOrgasmusAnforderungNotifications as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date("2026-07-25T15:00:00Z");
const due = {
  id: "oa1", userId: "u1", art: "GELEGENHEIT", message: null, requiredType: null, openingAllowed: false,
  beginsAt: new Date("2026-07-25T15:00:00Z"), endsAt: new Date("2026-07-26T15:00:00Z"),
  wirksamAb: new Date("2026-07-25T15:00:00Z"), createdBy: "kh", user: { email: "x", username: "sub", orgasmusArtenConfig: null, locale: "de" },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  findMany.mockResolvedValue([due]);
  updateMany.mockResolvedValue({ count: 1 });
});

describe("processDueOrgasmusAnforderungen", () => {
  it("beansprucht die Zeile mit Zustandsbedingung und stellt dann zu", async () => {
    await processDueOrgasmusAnforderungen(NOW);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "oa1", withdrawnAt: null, benachrichtigtAt: null }),
    }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("zurückgezogen zwischen Auswahl und Versand (count 0): nicht benachrichtigen", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await processDueOrgasmusAnforderungen(NOW);
    expect(send).not.toHaveBeenCalled();
  });

  it("scheitert der Versand, wird der Anspruch zurückgenommen (nächster Tick versucht es erneut)", async () => {
    send.mockRejectedValueOnce(new Error("smtp down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await processDueOrgasmusAnforderungen(NOW);
    const revert = updateMany.mock.calls.at(-1)?.[0];
    expect(revert.where).toMatchObject({ id: "oa1", withdrawnAt: null });
    expect(revert.data).toMatchObject({ benachrichtigtAt: null, beginsAt: due.beginsAt, endsAt: due.endsAt });
  });
});
