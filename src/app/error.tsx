"use client";

import ErrorScreen from "@/app/components/ErrorScreen";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen kind="error" error={error} reset={reset} standalone />;
}
