import { useRef, useState, type FormEvent } from "react";
import {
  useBbNavigate,
  experimental_useRpcQuery as useRpcQuery,
  experimental_useRpcMutation as useRpcMutation,
} from "@get-bb/plugin-sdk/app";
import { createSchema, managementContract } from "../lib/setup/contracts.ts";
import { uiContract } from "../lib/ui/contracts.ts";
import { Button } from "./ui/button.tsx";
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
    } catch {
      setError(
        "Creation delivery is unconfirmed. Check the recorded request before creating another bot; no automatic retry was sent.",
      );
    } finally {
      submitting.current = false;
    }
  }
  if (pending)
    return (
      <section className="space-y-3" aria-label="Pending bot creation">
        <h2 className="font-semibold">
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
      className="space-y-3"
      aria-label="Create a bot"
    >
      <h2 className="font-semibold">Create a collaborator</h2>
      <label className="block">
        Name
        <input
          className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-3 text-foreground"
          value={name}
          maxLength={128}
          required
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="block">
        Machine
        <select
          className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-3 text-foreground"
          value={hostId}
          required
          disabled={unavailable}
          onChange={(event) => {
            setHostId(event.target.value);
            setChoice(null);
            setChoosing(false);
          }}
        >
          <option value="">Choose a connected machine</option>
          {machines.map((machine) => (
            <option
              key={machine.id}
              value={machine.id}
              disabled={machine.status !== "connected"}
            >
              {machine.name}
              {machine.status !== "connected" ? " · Offline" : ""}
            </option>
          ))}
        </select>
      </label>
      {!unavailable &&
        !machines.some((machine) => machine.status === "connected") && (
          <p role="status">Connect a machine, then refresh to create a bot.</p>
        )}
      <label className="block">
        Home base (optional)
        <input
          className="mt-1 block h-9 w-full rounded-md border border-input bg-background px-3 text-foreground"
          value={homeBase}
          placeholder="~/.bb-bots on the selected machine"
          onChange={(event) => setHomeBase(event.target.value)}
        />
      </label>
      <p className="text-sm text-muted-foreground">
        Leave the home base empty for the default. A custom base must be an
        absolute path outside repositories and BB data. The bot has no project
        associations initially; the CLI can choose all or selected projects.
      </p>
      {hostId && (
        <ExecutionChoice
          key={hostId}
          hostId={hostId}
          onChoosing={setChoosing}
          onChange={setChoice}
        />
      )}
      <p className="text-sm text-muted-foreground">
        Create starts one short setup acknowledgement, then waits for you.
        Automatic workers, maintenance and fallback are off.
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={disabled || create.isPending}>
        Create bot
      </Button>
    </form>
  );
}
