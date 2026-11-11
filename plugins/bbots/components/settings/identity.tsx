import { useEffect, useId, useState, type FormEvent } from "react";
import { experimental_useRpcMutation as useRpcMutation } from "@get-bb/plugin-sdk/app";
import type { Bot } from "../../lib/storage/schema.ts";
import { managementContract } from "../../lib/setup/contracts.ts";
import { Input } from "../ui/input.tsx";
import { Button } from "../ui/button.tsx";
import {
  SettingsGroup,
  SettingRow,
  SETTINGS_CONTROL_CLASS,
} from "./layout.tsx";

export function IdentitySettings({
  bot,
  reread,
}: {
  bot: Bot;
  reread(): void;
}) {
  const inputId = useId();
  const [base, setBase] = useState(bot),
    [name, setName] = useState(bot.name);
  const [saved, setSaved] = useState(false);
  const dirty = name !== base.name;
  const mutation = useRpcMutation({
    contract: managementContract,
    method: "rename",
  });
  useEffect(() => {
    if (!dirty && bot.revision >= base.revision) {
      setBase(bot);
      setName(bot.name);
    }
  }, [bot, base.revision, dirty]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!dirty || mutation.isPending || !name.trim()) return;
    try {
      const result = await mutation.mutate({
        botId: bot.id,
        name,
        expectedRevision: base.revision,
      });
      setBase(result.bot);
      setName(result.bot.name);
      setSaved(true);
      reread();
    } catch {
      setSaved(false);
    }
  }
  return (
    <SettingsGroup title="Identity">
      <form onSubmit={(event) => void save(event)} className="space-y-3">
        <SettingRow
          label="Name"
          htmlFor={inputId}
          description="Updates managed conversation titles. The bot's identity, home and pin preference stay the same."
        >
          <Input
            id={inputId}
            className={SETTINGS_CONTROL_CLASS}
            value={name}
            maxLength={128}
            required
            onChange={(event) => {
              setName(event.target.value);
              setSaved(false);
            }}
          />
        </SettingRow>
        {mutation.error && (
          <p role="alert" className="text-xs text-destructive">
            Could not confirm the name save. Your draft is kept; read the saved
            version before trying again.
          </p>
        )}
        {saved && (
          <p role="status" className="text-xs text-muted-foreground">
            Name saved.
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {mutation.error && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setName(base.name);
                mutation.reset();
                reread();
              }}
            >
              Discard draft and read saved name
            </Button>
          )}
          <Button
            type="submit"
            size="sm"
            disabled={!dirty || !name.trim() || mutation.isPending}
          >
            {mutation.isPending ? "Saving…" : "Save name"}
          </Button>
        </div>
      </form>
    </SettingsGroup>
  );
}
