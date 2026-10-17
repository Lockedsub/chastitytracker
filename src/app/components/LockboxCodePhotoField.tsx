"use client";

import { useTranslations } from "next-intl";
import Button from "./Button";
import Card from "./Card";
import FormField from "./FormField";
import PhotoCapture from "./PhotoCapture";
import { PhotoUploadError } from "./PhotoUploadNotes";
import { PhotoAnalysisInfo } from "./PhotoAnalysisContext";
import { LockClosedIcon } from "./lockIcons";
import type { useLockboxCodePhoto } from "@/app/hooks/useLockboxCodePhoto";
import type { usePhotoUpload } from "@/app/hooks/usePhotoUpload";

type LockboxCodeUpload = Pick<ReturnType<typeof usePhotoUpload>, "imageUrl" | "uploading" | "uploadError" | "handleFile" | "clearPhoto">;

/**
 * Das Bildersafe-Feld: Code-Foto aufnehmen, Zustand zeigen, bei demselben Code wie beim letzten
 * Verschluss warnen (Issue #115). Geteilt vom Verschluss-Formular und vom Formular „Code versiegeln"
 * — beide trugen denselben Block bisher je selbst.
 *
 * Keine Vorschau des Fotos: der Sub soll die Ziffern nicht sehen. Das ⓘ der Foto-Prüfung steht am
 * Feld, weil das Foto für Lesbarkeit und Codewechsel an den Vision-Provider gehen kann.
 */
export default function LockboxCodePhotoField({ photo, check, mobileDesktopMode }: {
  photo: LockboxCodeUpload;
  check: ReturnType<typeof useLockboxCodePhoto>;
  mobileDesktopMode?: boolean;
}) {
  const t = useTranslations("lockForm");
  const { readable, checking, sameUnconfirmed, sameAcknowledged } = check;
  const warn = readable === false || sameUnconfirmed;

  return (
    <FormField label={t("codePhotoLabel")} labelAddon={<PhotoAnalysisInfo />}>
      {photo.imageUrl ? (
        <div className="flex flex-col gap-2">
          {/* Ganze Fläche = neu aufnehmen. */}
          <button type="button" onClick={photo.clearPhoto} className="text-left w-full">
            <Card variant="semantic" semantic={warn ? "warn" : "sperrzeit"}>
              <div className="flex items-start gap-2.5">
                <LockClosedIcon size={16} className={`flex-shrink-0 mt-0.5 ${warn ? "text-warn" : "text-sperrzeit"}`} />
                <div className="text-neben flex-1">
                  <p className={`font-bold ${warn ? "text-warn-text" : "text-sperrzeit-text"}`}>{t("codePhotoSealed")}</p>
                  <p className={`mt-0.5 ${warn ? "text-warn" : "text-sperrzeit"}`}>
                    {checking
                      ? t("codePhotoChecking")
                      : readable === false
                        ? t("codePhotoUnreadable")
                        : readable === true
                          ? t("codePhotoReadable")
                          : t("codePhotoNoCheck")}
                  </p>
                  <p className="text-foreground-faint mt-1.5 underline">{t("codePhotoRetake")}</p>
                </div>
              </div>
            </Card>
          </button>
          {sameUnconfirmed && (
            <Card variant="semantic" semantic="warn" role="alert">
              <p className="text-neben font-bold text-warn-text">{t("codeSameTitle")}</p>
              <p className="text-neben text-warn mt-0.5">{t("codeSameText")}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                <Button type="button" variant="secondary" size="sm" onClick={photo.clearPhoto}>{t("codeSameRetake")}</Button>
                <Button type="button" variant="ghost" size="sm" onClick={check.acknowledgeSame}>{t("codeSameAnyway")}</Button>
              </div>
            </Card>
          )}
          {sameAcknowledged && (
            <p className="text-neben text-foreground-muted">{t("codeSameAcknowledged")}</p>
          )}
        </div>
      ) : (
        <>
          <p className="text-neben text-foreground-faint mb-1.5">{t("codePhotoHint")}</p>
          <PhotoCapture onFile={photo.handleFile} uploading={photo.uploading} variant="emerald" mobileDesktopMode={mobileDesktopMode} />
          <PhotoUploadError uploadError={photo.uploadError} uploading={photo.uploading} />
        </>
      )}
    </FormField>
  );
}
