import { HandleReclaim, HumanProfile } from "./identity-forms.tsx";
import { useId, useState } from "react";
import { useActing } from "./acting-context.ts";
import { useIdentitySettings } from "./use-identity-settings.ts";
import { normalizeName } from "../../lib/names.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Pagination } from "./pagination.tsx";
export function IdentitySettings() {
  const acting = useActing();
  if (!acting.identity) return null;
  return (
    <details className="border-t border-border py-3">
      <summary className="cursor-pointer text-sm font-medium">
        Identity and handles
      </summary>
      <Settings
        key={JSON.stringify([
          acting.projectId,
          acting.identity.stationId,
          acting.identity.actorId,
          acting.identity.sessionId,
        ])}
      />
    </details>
  );
}
function Settings() {
  const acting = useActing();
  const identity = acting.identity!;
  const id = useId();
  const settings = useIdentitySettings();
  const [targetId, setTarget] = useState(
    identity.sessionId ?? identity.actorId,
  );
  const [name, setName] = useState("");
  const [reclaim, setReclaim] = useState<{
    name: string;
    targetId: string;
  } | null>(null);
  const [checked, setChecked] = useState(false);
  let canonical: string | null = null;
  let nameError: string | null = null;
  if (name) {
    try {
      canonical = normalizeName(name).name;
      if (["user", "ch"].includes(canonical)) {
        canonical = null;
        nameError = "user and ch are reserved.";
      }
    } catch (error) {
      nameError =
        error instanceof Error ? error.message : "Choose a valid handle.";
    }
  }
  const locked = settings.blocked || !!settings.uncertain;
  return (
    <section aria-label="Identity settings" className="space-y-3 pt-3">
      <p className="text-xs text-muted-foreground break-words">
        Actor: <code>{identity.actorId}</code>
        {identity.sessionId ? (
          <>
            {" "}
            · Acting session: <code>{identity.sessionId}</code>
          </>
        ) : null}
        . Canonical identities survive handle changes.
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={settings.blocked}
        onClick={() => void settings.read("handles")}
      >
        Inspect handles
      </Button>
      <p className="text-xs text-muted-foreground">
        Project handle pages show the last manual check, including aliases. A
        name absent from one page may be allocated elsewhere. Inspect again
        after changes.
      </p>
      {settings.error ? (
        <p role="alert" className="text-sm text-destructive break-words">
          {settings.error} Displayed settings may be out of date.
        </p>
      ) : null}
      {settings.confirmation ? (
        <p role="status" className="text-sm break-words">
          {settings.confirmation}
        </p>
      ) : null}
      {settings.page ? (
        <>
          {!settings.page.items.length ? (
            <p className="text-sm text-muted-foreground">
              No handles on this page.
            </p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {settings.page.items.map((handle) => (
                <li key={handle.name} className="space-y-1 py-2 break-words">
                  <p>
                    @{handle.name} · {handle.isPrimary ? "Primary" : "Alias"} ·{" "}
                    <code>{handle.targetId}</code>
                  </p>
                  {!handle.isPrimary &&
                  [identity.actorId, identity.sessionId].includes(
                    handle.targetId,
                  ) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={locked}
                      onClick={() =>
                        void settings.change({
                          op: "alias-remove",
                          input: { name: handle.name },
                        })
                      }
                    >
                      Remove alias @{handle.name}
                    </Button>
                  ) : null}
                  {acting.mode === "operator" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={locked}
                      onClick={() => {
                        setReclaim({
                          name: handle.name,
                          targetId: handle.targetId,
                        });
                      }}
                    >
                      Review reclaim @{handle.name}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <Pagination
            pending={settings.blocked}
            hasMore={settings.page.hasMore}
            canBack={settings.canBack}
            next={() => void settings.next()}
            back={() => void settings.back()}
            refresh={() => settings.read("handles")}
          />
        </>
      ) : null}
      <fieldset disabled={locked} className="space-y-2 min-w-0">
        <legend className="text-sm font-medium">Your project handle</legend>
        <div className="flex flex-wrap gap-3">
          {identity.sessionId ? (
            <label className="flex min-h-9 items-center gap-2 text-sm">
              <input
                type="radio"
                name={`${id}-target`}
                checked={targetId === identity.sessionId}
                onChange={() => setTarget(identity.sessionId!)}
              />
              Acting session
            </label>
          ) : null}
          <label className="flex min-h-9 items-center gap-2 text-sm">
            <input
              type="radio"
              name={`${id}-target`}
              checked={targetId === identity.actorId}
              onChange={() => setTarget(identity.actorId)}
            />
            {acting.mode === "operator"
              ? "Human personal handle"
              : "Actor-wide"}
          </label>
        </div>
        <label className="text-sm" htmlFor={`${id}-name`}>
          Handle name
        </label>
        <Input
          id={`${id}-name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="agent-name"
        />
        {canonical ? (
          <p className="text-sm break-words">
            Will use @{canonical}
            {canonical !== name ? " (automatically repaired)" : ""}.
          </p>
        ) : nameError ? (
          <p className="text-sm text-destructive">{nameError}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={!canonical}
            onClick={() =>
              void settings.change({
                op: "handle-assign",
                input: { name, targetId },
              })
            }
          >
            Assign handle
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!canonical}
            onClick={() =>
              void settings.change({
                op: "handle-rename",
                input: { name, targetId },
              })
            }
          >
            Rename (keep alias)
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Collisions are refused without moving another identity. Renaming
          retains old aliases; removing an alias affects future lookups only.
          @user always identifies the station human.
        </p>
      </fieldset>
      {acting.mode === "operator" && reclaim ? (
        <HandleReclaim
          key={JSON.stringify(reclaim)}
          reclaim={reclaim}
          settings={settings}
        />
      ) : null}
      {acting.mode === "operator" ? <HumanProfile settings={settings} /> : null}
      {settings.uncertain ? (
        <div className="space-y-2 text-sm">
          <p>
            This change has no replay key. Inspect{" "}
            {settings.uncertain === "profile" ? "the human profile" : "handles"}{" "}
            before choosing a new intent; repeating it could override another
            panel's changes.
          </p>
          <label className="flex min-h-9 items-center gap-2">
            <input
              type="checkbox"
              checked={checked}
              disabled={settings.blocked || !settings.inspected}
              onChange={(e) => setChecked(e.target.checked)}
            />
            I inspected settings and intend to make a new change.
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={settings.blocked || !settings.inspected || !checked}
            onClick={() => {
              settings.allowNewChange();
              setChecked(false);
            }}
          >
            Allow a new settings change
          </Button>
        </div>
      ) : null}
    </section>
  );
}
