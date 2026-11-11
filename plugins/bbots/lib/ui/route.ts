export type BotRoute =
  | { page: "list" }
  | { page: "new" }
  | { page: "invalid" }
  | { page: "detail" | "settings"; botId: string };

export function botRoute(subPath: string): BotRoute {
  if (!subPath) return { page: "list" };
  if (subPath === "new") return { page: "new" };
  try {
    const parts = subPath.split("/").map(decodeURIComponent);
    const [botId, page] = parts;
    if (
      !botId ||
      botId.length > 128 ||
      botId.includes("/") ||
      parts.length > 2 ||
      (page !== undefined && page !== "settings")
    )
      return { page: "invalid" };
    return { page: page === "settings" ? "settings" : "detail", botId };
  } catch {
    return { page: "invalid" };
  }
}
