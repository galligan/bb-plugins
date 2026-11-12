import { useId, useRef, useState, type FormEvent } from "react";
import {
  useBbNavigate,
  experimental_useRpcQuery as useRpcQuery,
  experimental_useRpcMutation as useRpcMutation,
  experimental_PluginRpcCallError as RpcCallError,
} from "@get-bb/plugin-sdk/app";
import { createSchema, managementContract } from "../lib/setup/contracts.ts";
import { uiContract } from "../lib/ui/contracts.ts";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select.tsx";
import { SettingsGroup, SettingRow } from "./settings/layout.tsx";
import type { Machine } from "./bots-panel.tsx";
import { ExecutionChoice, type Choice } from "./execution-choice.tsx";

export const pendingCreationKey = "bbots.pendingCreation";
function pendingRequest() {
  try {
    const input = uiContract.creation.input.safeParse({
      requestId: sessionStorage.getItem(pendingCreationKey),
    });
    return input.success ? input.data.requestId : null;
  } catch {
    return null;
  }
}
export function CreateBot({
  machines,
  unavailable,
}: {
  machines: Machine[];
  unavailable: boolean;
}) {
  const navigate = useBbNavigate();
  const formId = useId();
  const create = useRpcMutation({
    contract: managementContract,
    method: "create",
  });
  const [pending, setPending] = useState(pendingRequest);
  const receipt = useRpcQuery({
    contract: uiContract,
    method: "creation",
    input: { requestId: pending ?? "00000000-0000-4000-8000-000000000000" },
    enabled: pending !== null,
  });
  const [name, setName] = useState("Bob");
  const [hostId, setHostId] = useState("");
  const [homeBase, setHomeBase] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const disabled =
    unavailable || !hostId || !name.trim() || (choosing && !choice);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || pending || submitting.current) return;
    setError(null);
    if (
      homeBase.trim() &&
      !/^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(homeBase.trim())
    ) {
      setError(
        "Use an absolute home base on the selected machine, or leave it empty for the default.",
      );
      return;
    }
    const input = createSchema.safeParse({
      requestId: crypto.randomUUID(),
      name,
      hostId,
      ...(homeBase.trim() ? { homeBase: homeBase.trim() } : {}),
      ...choice,
    });
    if (!input.success) {
      setError(input.error.issues.map((i) => i.message).join("; "));
      return;
    }
    try {
      sessionStorage.setItem(pendingCreationKey, input.data.requestId);
    } catch {
      setError(
        "Could not retain the creation receipt in this browser. Use the CLI with an explicit request ID, or allow session storage before creating.",
      );
      return;
    }
    submitting.current = true;
    setPending(input.data.requestId);
    try {
      const value = await create.mutate(input.data);
      sessionStorage.removeItem(pendingCreationKey);
      setPending(null);
      navigate.toPluginPanel("bots", { subPath: value.bot.id });
    } catch (error) {
      if (
        error instanceof RpcCallError &&
        (error.code === "invalid" || error.code === "invalid_input")
      ) {
        try {
          // These refusals occur before creation intent, so the form can be corrected safely.
          sessionStorage.removeItem(pendingCreationKey);
          setPending(null);
          setError(error.message);
          return;
        } catch {
          /* Keep the receipt when browser storage cannot be cleared. */
        }
      }
      setError(
        "Creation delivery is unconfirmed. Check the recorded request before creating another bot; no automatic retry was sent.",
      );
    } finally {
      submitting.current = false;
    }
  }
  if (pending)
    return (
      <section
        className="space-y-3 rounded-lg border border-border bg-card p-4"
        aria-label="Pending bot creation"
      >
        <h2 className="text-sm font-semibold">
          {create.isPending
            ? "Creating your collaborator…"
            : "Check the creation request"}
        </h2>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {receipt.error && (
          <p role="alert">
            Could not read the request. Check the connection and try the read
            again.
          </p>
        )}
        {!receipt.isLoading && !receipt.error && !receipt.data && (
          <p>
            The request has not been found yet. Do not submit a duplicate while
            delivery is uncertain.
          </p>
        )}
        {receipt.data ? (
          <Button
            type="button"
            disabled={create.isPending}
            onClick={() => {
              sessionStorage.removeItem(pendingCreationKey);
              navigate.toPluginPanel("bots", { subPath: receipt.data!.bot.id });
            }}
          >
            Open {receipt.data.bot.name} setup
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={receipt.isFetching || create.isPending}
            onClick={() => void receipt.refetch()}
          >
            Check request
          </Button>
        )}
        <details>
          <summary>Recovery details</summary>
          <code className="break-all">{pending}</code>
        </details>
      </section>
    );
  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="space-y-6"
      aria-label="Create a bot"
    >
      <SettingsGroup
        title="Collaborator"
        description="Create Bob, or choose another name. Its home and conversation persist independently of the selected sidebar."
      >
        <SettingRow label="Name" htmlFor={`${formId}-name`}>
          <Input
            id={`${formId}-name`}
            value={name}
            maxLength={128}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </SettingRow>
        <SettingRow
          label="Machine"
          htmlFor={`${formId}-machine`}
          description="The machine that keeps this bot's persistent home."
        >
          <Select
            value={hostId}
            required
            disabled={unavailable}
            onValueChange={(value) => {
              setHostId(value);
              setChoice(null);
              setChoosing(false);
            }}
          >
            <SelectTrigger id={`${formId}-machine`}>
              <SelectValue placeholder="Choose a connected machine" />
            </SelectTrigger>
            <SelectContent>
              {machines.map((machine) => (
                <SelectItem
                  key={machine.id}
                  value={machine.id}
                  disabled={machine.status !== "connected"}
                >
                  {machine.name}
                  {machine.status !== "connected" ? " · Offline" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        {!unavailable &&
          !machines.some((machine) => machine.status === "connected") && (
            <p role="status" className="text-xs text-muted-foreground">
              Connect a machine, then refresh to create a bot.
            </p>
          )}
      </SettingsGroup>
      {hostId && (
        <SettingsGroup
          title="Execution"
          description="Use BB defaults or choose native model and permission controls for the new conversation."
        >
          <ExecutionChoice
            key={hostId}
            hostId={hostId}
            initial={choice ?? undefined}
            onChoosing={setChoosing}
            onChange={setChoice}
          />
        </SettingsGroup>
      )}
      <details
        className="text-xs text-muted-foreground"
        open={advanced}
        onToggle={(event) => setAdvanced(event.currentTarget.open)}
      >
        <summary className="cursor-pointer">Advanced</summary>
        <div className="mt-3">
          <SettingRow
            label="Home base (optional)"
            htmlFor={`${formId}-home`}
            description="Leave empty for the default. A custom base must be an absolute path outside repositories and BB data."
          >
            <Input
              id={`${formId}-home`}
              value={homeBase}
              placeholder="~/.bb-bots on the selected machine"
              onChange={(event) => setHomeBase(event.target.value)}
            />
          </SettingRow>
        </div>
        <p className="mt-2 leading-5">
          No project associations initially; the CLI can choose all or selected
          projects.
        </p>
      </details>
      <p className="text-xs leading-5 text-muted-foreground">
        Create starts one short setup acknowledgement, then waits for you.
        Automatic workers, maintenance and fallback are off.
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={disabled || create.isPending}>
          Create bot
        </Button>
      </div>
    </form>
  );
}
