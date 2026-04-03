export function createSupabaseCommand(openDialog: () => void) {
  return {
    title: "Connect Supabase",
    value: "supabase.connect",
    slash: { name: "supabase" },
    onSelect: openDialog,
  };
}
