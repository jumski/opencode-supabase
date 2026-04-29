export function createSupabaseCommand(openDialog: () => void) {
  return {
    title: "Connect to Supabase",
    value: "supabase.connect",
    slash: { name: "supabase" },
    onSelect: openDialog,
  };
}
