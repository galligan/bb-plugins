import { useEffect, useRef, useState } from "react";
import {
  useSdk,
  experimental_ProviderModelPicker as ProviderModelPicker,
  experimental_PermissionModePicker as PermissionModePicker,
  type ExperimentalProviderModelPickerValue,
} from "@get-bb/plugin-sdk/app";

import type { ExecutionDefaults } from "../lib/soul/contracts.ts";
import { Checkbox } from "./ui/checkbox.tsx";
import { Button } from "./ui/button.tsx";

export type Choice = ExperimentalProviderModelPickerValue & {
  permissionMode: "accept-edits" | "auto" | "full";
};
export function ExecutionChoice({
  hostId,
  onChoosing,
  onChange,
  initial,
  label = "Choose a model and permissions",
}: {
  hostId: string;
  onChoosing(value: boolean): void;
  onChange(value: Choice | null): void;
  initial?: ExecutionDefaults["main"];
  label?: string;
}) {
  const sdk = useSdk();
  const [seed, setSeed] = useState(initial);
  const initializeRequested = useRef(false);
  const [custom, setCustom] = useState(
    initial !== undefined && Object.keys(initial).length > 0,
  );
  const [choice, setChoice] = useState<Choice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<
    Record<string, Choice["permissionMode"][]>
  >({});
  useEffect(() => {
    setChoice(null);
    setError(null);
    if (!custom) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(10000),
    ]);
    void (async () => {
      const providers = await sdk.providers.list({
        hostId,
        signal,
      });
      for (const provider of providers
        .filter(
          (p) => p.available && (!seed?.providerId || p.id === seed.providerId),
        )
        .slice(0, 16)) {
        signal.throwIfAborted();
        let options;
        try {
          options = await sdk.providers.models({
            hostId,
            providerId: provider.id,
            signal,
          });
        } catch {
          signal.throwIfAborted();
          continue;
        }
        const model = seed?.model
          ? options.models.find((m) => m.model === seed.model)
          : (options.models.find((m) => m.isDefault) ?? options.models[0]);
        const modes = ["accept-edits", "auto", "full"] as const;
        const allowed = Object.fromEntries(
          providers.map((p) => [
            p.id,
            modes.filter(
              (mode, rank) =>
                rank <= modes.indexOf(options.permissionCeiling) &&
                p.capabilities.permissionModes.includes(mode),
            ),
          ]),
        );
        const permissionMode =
          seed?.permissionMode ??
          modes.find(
            (mode, rank) =>
              rank <= modes.indexOf(options.permissionCeiling) &&
              provider.capabilities.permissionModes.includes(mode),
          );
        if (
          !model ||
          options.modelLoadError ||
          !permissionMode ||
          !allowed[provider.id]?.includes(permissionMode)
        )
          continue;
        const next = {
          providerId: provider.id,
          model: model.model,
          reasoningLevel: seed?.reasoningLevel ?? model.defaultReasoningEffort,
          permissionMode,
          ...(provider.capabilities.supportsServiceTier
            ? { serviceTier: seed?.serviceTier ?? "default" }
            : {}),
        };
        if (!controller.signal.aborted) {
          setPermissions(allowed);
          setChoice(next);
          // Loading an existing setting only resolves its display. A picker
          // interaction or explicit reset is required to change persisted defaults.
          if (initializeRequested.current) {
            initializeRequested.current = false;
            onChange(next);
          }
        }
        return;
      }
      throw new Error("No usable native execution choices");
    })().catch(() => {
      if (!controller.signal.aborted)
        setError(
          "Could not load native choices. Check the machine/provider, or turn off custom choices to use BB defaults.",
        );
    });
    return () => controller.abort();
  }, [sdk, hostId, custom, onChange, seed]);
  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">Execution choices</legend>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={custom}
          onCheckedChange={(checked) => {
            const value = checked === true;
            initializeRequested.current = value;
            setCustom(value);
            onChoosing(value);
            onChange(null);
          }}
        />
        {label}
      </label>
      {!custom && (
        <p className="text-sm text-muted-foreground">Uses BB defaults.</p>
      )}
      {custom && !choice && !error && (
        <p role="status">Loading native execution choices…</p>
      )}
      {error && (
        <div className="space-y-2">
          <p role="alert" className="text-destructive">
            {error}
          </p>
          {seed !== undefined && (
            <>
              <p className="text-xs text-muted-foreground">
                Your saved choice is retained. Load available replacements, then
                select one explicitly before saving.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  initializeRequested.current = false;
                  setSeed(undefined);
                }}
              >
                Choose available replacement
              </Button>
            </>
          )}
        </div>
      )}
      {custom && choice && (
        <div className="flex flex-wrap gap-2">
          <ProviderModelPicker
            value={choice}
            routing={{ kind: "host", hostId }}
            onChange={(value) => {
              const allowed = permissions[value.providerId] ?? [];
              const permissionMode = allowed.includes(choice.permissionMode)
                ? choice.permissionMode
                : allowed[0];
              if (!permissionMode) {
                setError(
                  "This provider has no permission mode allowed on the machine. The previous selection is retained.",
                );
                return;
              }
              const next = { ...value, permissionMode };
              setError(null);
              setChoice(next);
              onChange(next);
            }}
          />
          <PermissionModePicker
            providerId={choice.providerId}
            value={choice.permissionMode}
            routing={{ kind: "host", hostId }}
            onChange={(permissionMode) => {
              if (!permissions[choice.providerId]?.includes(permissionMode)) {
                setError(
                  "That permission choice is unavailable on this machine. The previous selection is retained.",
                );
                return;
              }
              const next = { ...choice, permissionMode };
              setError(null);
              setChoice(next);
              onChange(next);
            }}
          />
        </div>
      )}
    </fieldset>
  );
}
