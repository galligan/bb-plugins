/** BB display names are mutable; use canonical IDs consistently when a page needs disambiguation. */
export function choiceLabels(
  items: readonly { id: string; name: string | null }[],
  unnamed: string,
) {
  const names = items.map((item) => item.name?.trim() ?? "");
  const showIds = names.includes("") || new Set(names).size !== names.length;
  return items.map((item, index) => ({
    id: item.id,
    // Suffix every option together: a literal name may match a generated label.
    label: showIds ? `${names[index] || unnamed} · ${item.id}` : names[index]!,
  }));
}
