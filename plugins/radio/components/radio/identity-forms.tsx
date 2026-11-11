import { useId, useState } from "react";
import { useActing } from "./acting-context.ts";
import type { useIdentitySettings } from "./use-identity-settings.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
type Settings = ReturnType<typeof useIdentitySettings>;
export function HandleReclaim({
  reclaim,
  settings,
}: {
  reclaim: { name: string; targetId: string };
  settings: Settings;
}) {
  const acting = useActing();
  const id = useId();
  const [reclaimTarget, setReclaimTarget] = useState(acting.identity!.actorId);
  const [consent, setConsent] = useState(false);
  const locked = settings.blocked || !!settings.uncertain;
  return (
    <fieldset disabled={locked} className="space-y-2 min-w-0">
      <legend className="text-sm font-medium">Reclaim @{reclaim.name}</legend>
      <p className="text-sm break-words">
        Holder at last check: <code>{reclaim.targetId}</code>. Reclaiming may
        assign the prior primary holder a unique fallback. History and
        commitments keep their canonical owners.
      </p>
      <label htmlFor={`${id}-reclaim-target`} className="text-sm">
        Reclaim for canonical participant ID
      </label>
      <Input
        id={`${id}-reclaim-target`}
        value={reclaimTarget}
        onChange={(e) => {
          setReclaimTarget(e.target.value);
          setConsent(false);
        }}
      />
      <label className="flex min-h-9 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        I intend to change future address ownership for this name.
      </label>
      <Button
        size="sm"
        disabled={!consent || !reclaimTarget || reclaimTarget.length > 256}
        onClick={() =>
          void settings.change({
            op: "handle-reclaim",
            input: { name: reclaim.name, targetId: reclaimTarget },
          })
        }
      >
        Reclaim handle
      </Button>
    </fieldset>
  );
}
export function HumanProfile({ settings }: { settings: Settings }) {
  const id = useId();
  const [displayName, setDisplayName] = useState("");
  const locked = settings.blocked || !!settings.uncertain;
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <h3 className="text-sm font-medium">Station human</h3>
      <Button
        size="sm"
        variant="outline"
        disabled={settings.blocked}
        onClick={() => void settings.read("profile")}
      >
        Inspect human profile
      </Button>
      {settings.profile ? (
        <p className="text-sm break-words">
          Display name at last check: {settings.profile.displayName}
        </p>
      ) : null}
      <fieldset disabled={locked} className="space-y-2">
        <label htmlFor={`${id}-display`} className="text-sm">
          Human display name
        </label>
        <Input
          id={`${id}-display`}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <Button
          size="sm"
          disabled={!displayName.trim() || displayName.length > 256}
          onClick={() =>
            void settings.change({
              op: "human-profile-set",
              input: { displayName },
            })
          }
        >
          Save display name
        </Button>
      </fieldset>
      <p className="text-xs text-muted-foreground">
        The display name is station-wide. The personal handle above belongs to
        this project. Neither changes the human ID or reserved @user address.
      </p>
    </div>
  );
}
