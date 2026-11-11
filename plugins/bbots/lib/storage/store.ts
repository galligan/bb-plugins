import type { PluginStorage } from "@get-bb/plugin-sdk";
import { Conversations } from "./conversations.ts";
import { Documents } from "./documents.ts";
import { migrations } from "./migrations.ts";
import { Profiles } from "./profiles.ts";

export function openStore(storage: PluginStorage) {
  const db = storage.database();
  db.pragma("foreign_keys = ON");
  storage.migrate(db, migrations);
  return {
    profiles: new Profiles(db),
    documents: new Documents(db),
    conversations: new Conversations(db),
  };
}
