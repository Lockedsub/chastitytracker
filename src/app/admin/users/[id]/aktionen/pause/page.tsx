import { prisma } from "@/lib/prisma";
import { getTranslations } from "next-intl/server";
import { assertKeyholderOrAdmin } from "@/lib/authGuards";
import { getUserTimezone } from "@/lib/queries";
import { nowDatetimeLocal } from "@/lib/utils";
import { effectiveOeffnenGruende, resolveReasonList } from "@/lib/reasonsService";
import PauseForm from "./PauseForm";

/** Eine vergessene Pause nachtragen. Anders als `oeffnen` ohne Gate auf „aktuell verschlossen":
 *  die Pause liegt in der VERGANGENHEIT, der Träger darf heute offen sein. */
export default async function AdminPausePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await assertKeyholderOrAdmin(id);
  const [tz, user, tOpen] = await Promise.all([
    getUserTimezone(id),
    prisma.user.findUnique({ where: { id }, select: { oeffnenGruendeConfig: true } }),
    getTranslations("openForm"),
  ]);
  const grundOptions = resolveReasonList(effectiveOeffnenGruende(user?.oeffnenGruendeConfig), "opening", tOpen);
  return <PauseForm userId={id} grundOptions={grundOptions} tz={tz} nowDefault={nowDatetimeLocal(tz)} />;
}
