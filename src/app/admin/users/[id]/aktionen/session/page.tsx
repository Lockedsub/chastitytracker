import EntryGapPage from "../gap/EntryGapPage";

export default async function AdminSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EntryGapPage id={id} kind="session" />;
}
