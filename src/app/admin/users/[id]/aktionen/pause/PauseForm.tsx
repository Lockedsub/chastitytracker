"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import AdminActionFormShell from "@/app/components/AdminActionFormShell";
import EntryFormShell from "@/app/components/EntryFormShell";
import DateTimePicker from "@/app/components/DateTimePicker";
import Select from "@/app/components/Select";
import Textarea from "@/app/components/Textarea";
import Button from "@/app/components/Button";
import FormError from "@/app/components/FormError";
import RequiredHint from "@/app/components/RequiredHint";
import { fetchWithTimeout, parseApiErrorCode } from "@/lib/apiClient";
import { useApiError } from "@/app/hooks/useApiError";
import { fromDatetimeLocal } from "@/lib/utils";
import type { ResolvedReason } from "@/lib/reasonsService";
import { actionSign } from "@/app/entries/actionSign";
import { LockOpenIcon } from "@/app/components/lockIcons";

export default function PauseForm({ userId, grundOptions, tz, nowDefault }: {
  userId: string;
  grundOptions: ResolvedReason[];
  tz: string;
  nowDefault: string;
}) {
  const t = useTranslations("admin");
  const tCommon = useTranslations("common");
  const tOffen = useTranslations("openForm");
  const apiError = useApiError();
  const router = useRouter();
  const target = `/admin/users/${userId}/aktionen`;

  const [openAt, setOpenAt] = useState("");
  const [lockAt, setLockAt] = useState("");
  const [grund, setGrund] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetchWithTimeout("/api/admin/entries/gap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          openAt: fromDatetimeLocal(openAt, tz).toISOString(),
          lockAt: fromDatetimeLocal(lockAt, tz).toISOString(),
          oeffnenGrund: grund,
          note: note.trim(),
        }),
      });
      if (!res.ok) {
        setError(apiError(await parseApiErrorCode(res)));
        setSaving(false);
        return;
      }
      router.push(target);
    } catch {
      setError(tCommon("networkError"));
      setSaving(false);
    }
  }

  return (
    <AdminActionFormShell
      userId={userId}
      backLabel={t("aktionen")}
      {...actionSign("OEFFNEN")}
      title={t("pauseTitle")}
    >
      <EntryFormShell
        onSubmit={handleSubmit}
        onCancel={() => router.push(target)}
        cancelLabel={tCommon("cancel")}
        actions={
          <Button type="submit" variant="primary" fullWidth loading={saving} icon={<LockOpenIcon size={16} />}>
            {t("pauseSubmit")}
          </Button>
        }
      >
        <RequiredHint />
        <p className="text-fliess text-foreground-muted">{t("pauseIntro")}</p>
        <DateTimePicker
          label={t("pauseOpenAt")}
          value={openAt}
          onChange={(e) => setOpenAt(e.target.value)}
          max={nowDefault}
          required
        />
        <DateTimePicker
          label={t("pauseLockAt")}
          value={lockAt}
          onChange={(e) => setLockAt(e.target.value)}
          min={openAt || undefined}
          max={nowDefault}
          required
        />
        <Select
          label={tOffen("grundLabel")}
          value={grund}
          onChange={(e) => setGrund(e.target.value)}
          required
          placeholder="–"
          options={grundOptions.map((g) => ({ value: g.code, label: g.label }))}
        />
        <Textarea
          label={tCommon("comment")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          required
          placeholder={tOffen("commentPlaceholder")}
        />
        <FormError message={error} />
      </EntryFormShell>
    </AdminActionFormShell>
  );
}
