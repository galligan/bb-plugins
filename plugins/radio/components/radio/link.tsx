import {
  useBbNavigate,
  experimental_usePluginId,
} from "@get-bb/plugin-sdk/app";
import type { ReactNode } from "react";
import { routePath, type RadioRoute } from "./routes.ts";

export function RadioLink({
  route,
  children,
}: {
  route: RadioRoute;
  children: ReactNode;
}) {
  const navigate = useBbNavigate();
  const pluginId = experimental_usePluginId();
  const path = routePath(route);
  // The SDK documents this plugin-owned route. Keep a real anchor for modifier-click/copy;
  // plain activation uses the host navigator, including inside a split pane.
  const href = `/plugins/${encodeURIComponent(pluginId)}/radio/${path.split("/").map(encodeURIComponent).join("/")}`;
  return (
    <a
      href={href}
      className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring break-words"
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        navigate.toPluginPanel("radio", { subPath: path });
      }}
    >
      {children}
    </a>
  );
}
