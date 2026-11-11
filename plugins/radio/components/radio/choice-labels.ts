/** BB display names are mutable and may be duplicated; canonical IDs disambiguate choices. */
export function choiceLabels(
  items: readonly { id: string; name: string | null }[],
  unnamed: string,
) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const name = item.name?.trim() ?? "";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return items.map((item) => {
    const name = item.name?.trim() ?? "";
    return {
      id: item.id,
      label:
        !name || (counts.get(name) ?? 0) > 1
          ? `${name || unnamed} · ${item.id}`
          : name,
    };
  });
}
