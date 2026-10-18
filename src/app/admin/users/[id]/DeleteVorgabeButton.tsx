"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import ConfirmDialog from "@/app/components/ConfirmDialog";
import FormError from "@/app/components/FormError";

export default function DeleteVorgabeButton({ id }: { id: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const t = useTranslations("admin");
  const tc = useTranslations("common");

  async function handle() {
    setConfirmOpen(false);
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/vorgaben/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(tc("savingError"));
      router.refresh();
    } catch {
      setError(tc("networkError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button onClick={() => setConfirmOpen(true)} disabled={saving}
        className="text-xs font-medium text-warn-text bg-warn-bg border border-warn-border hover:opacity-80 rounded-lg px-2 py-1 transition disabled:opacity-50">
        {saving ? "…" : t("vorgabeDelete")}
      </button>
      <ConfirmDialog
        open={confirmOpen}
        danger
        title={t("vorgabeDelete")}
        message={t("vorgabeDeleteConfirm")}
        confirmLabel={t("vorgabeDelete")}
        onConfirm={handle}
        onCancel={() => setConfirmOpen(false)}
      />
      <FormError message={error} />
    </>
  );
}
