import { useState } from "react";
import {
  definePluginApp,
  experimental_useRpcQuery as useRpcQuery,
  experimental_useRpcMutation as useRpcMutation,
} from "@get-bb/plugin-sdk/app";
import { rpcContract } from "./contract";
import consumer from "./consumer.json";
import { Button } from "./components/ui/button";
import { COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS } from "./components/ui/coarse-pointer-sizing";

const useItems = () =>
  useRpcQuery({ contract: rpcContract, method: "list", input: {} });

function HeaderActions() {
  const query = useItems();
  return (
    <Button
      variant="outline"
      className={COARSE_POINTER_TOOLBAR_ACTION_BUTTON_CLASS}
      disabled={query.isFetching}
      onClick={() => void query.refetch()}
    >
      {query.isFetching ? "Refreshing…" : "Refresh"}
    </Button>
  );
}

function CollectionPanel() {
  const query = useItems();
  const mutation = useRpcMutation({ contract: rpcContract, method: "review" });
  const [selected, setSelected] = useState<string | null>(null);
  const item = query.data?.find((row) => row.id === selected);
  return (
    <main className="h-full min-h-0 min-w-0 overflow-y-auto p-4 text-foreground md:p-5">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        {query.isLoading && <p role="status">Loading items…</p>}
        {query.error && (
          <div role="alert" className="space-y-2 text-destructive">
            <p>Could not load items. Check the connection and retry.</p>
            <Button
              variant="outline"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              Retry
            </Button>
          </div>
        )}
        {query.data?.length === 0 && !query.error && (
          <p role="status">{consumer.empty}</p>
        )}
        <ul className="space-y-2" aria-label={consumer.title}>
          {query.data?.map((row) => (
            <li key={row.id}>
              <Button
                variant="ghost"
                className="h-auto min-h-9 w-full justify-start whitespace-normal break-words text-left max-md:pointer-coarse:min-h-11"
                disabled={mutation.isPending}
                aria-pressed={selected === row.id}
                aria-controls="item-detail"
                onClick={() => {
                  setSelected(row.id);
                  mutation.reset();
                }}
              >
                {row.title}
                {row.reviewed ? " · Reviewed" : ""}
              </Button>
            </li>
          ))}
        </ul>
        <section
          id="item-detail"
          aria-label="Item details"
          className="min-w-0 space-y-3 break-words"
        >
          {item ? (
            <>
              <h2 className="font-semibold">{item.title}</h2>
              <p>{item.detail}</p>
              <Button
                disabled={mutation.isPending || item.reviewed}
                onClick={() => {
                  void mutation.mutate({ id: item.id }).catch(() => {});
                }}
              >
                {mutation.isPending
                  ? "Saving…"
                  : item.reviewed
                    ? "Reviewed"
                    : "Mark reviewed"}
              </Button>
              {mutation.error && (
                <p role="alert" className="text-destructive">
                  Could not save. Your selection is retained; try again.
                </p>
              )}
            </>
          ) : query.data && query.data.length > 0 ? (
            <p>Select an item to inspect its details.</p>
          ) : null}
        </section>
      </div>
    </main>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "collection",
    title: consumer.title,
    icon: "ListTodo",
    path: "collection",
    component: CollectionPanel,
    headerContent: HeaderActions,
  });
});
