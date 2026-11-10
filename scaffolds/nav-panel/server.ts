import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./contract";
import consumer from "./consumer.json";

// Deliberately offline fixture data. Replace this adapter with bounded storage
// or host RPC; credentials belong in BB's native secret settings, never rows.
export default function register(bb: BbPluginApi) {
  const items = consumer.items.map((item) => ({ ...item }));
  bb.rpc.register(rpcContract, {
    list: () => items,
    review: ({ id }) => {
      const item = items.find((row) => row.id === id);
      if (!item)
        throw new Error("Item is no longer available. Refresh the list.");
      item.reviewed = true;
      bb.rpc.experimental_invalidate(["items"]);
      return { accepted: true };
    },
  });
}
