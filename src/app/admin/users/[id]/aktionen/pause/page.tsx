import EntryGapPage from "../gap/EntryGapPage";

export default async function AdminBreakPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EntryGapPage id={id} kind="break" />;
}
