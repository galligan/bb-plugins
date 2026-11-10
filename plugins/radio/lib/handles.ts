import type { Database, Handle, TrustedCaller } from "./contracts.ts";
import { idSchema } from "./contracts.ts";
import type { IdentityRegistry } from "./identity-registry.ts";
import type { ProjectRegistry } from "./project-registry.ts";
import { normalizeName, NAME_MAX } from "./names.ts";
import { RadioError } from "./errors.ts";

type HandleRow = Omit<Handle, "isPrimary"> & { isPrimary: number };
const COLUMNS =
  "project_id AS projectId, name, target_id AS targetId, is_primary AS isPrimary";

export class HandleRegistry {
  private db: Database;
  private identities: IdentityRegistry;
  private projects: ProjectRegistry;
  constructor(
    db: Database,
    identities: IdentityRegistry,
    projects: ProjectRegistry,
  ) {
    this.db = db;
    this.identities = identities;
    this.projects = projects;
  }

  lookup(projectId: string, name: string): Handle | null {
    const row = this.db
      .prepare<[string, string], HandleRow>(
        `SELECT ${COLUMNS} FROM handles WHERE project_id = ? AND name = ?`,
      )
      .get(idSchema.parse(projectId), this.name(name).name);
    return row ? { ...row, isPrimary: row.isPrimary === 1 } : null;
  }

  primary(projectId: string, targetId: string): Handle | null {
    const row = this.db
      .prepare<[string, string], HandleRow>(
        `SELECT ${COLUMNS} FROM handles WHERE project_id = ? AND target_id = ? AND is_primary = 1`,
      )
      .get(idSchema.parse(projectId), idSchema.parse(targetId));
    return row ? { ...row, isPrimary: true } : null;
  }

  assign(
    projectId: string,
    targetId: string,
    requested: string,
    caller: TrustedCaller,
  ) {
    const normalization = this.name(requested);
    return this.db
      .transaction(() => {
        this.authorize(projectId, targetId, caller);
        const existing = this.lookup(projectId, normalization.name);
        if (existing?.targetId === targetId && existing.isPrimary)
          return { handle: existing, normalization };
        if (existing || this.primary(projectId, targetId))
          throw new RadioError(
            "conflict",
            "Handle is allocated or this target already has a primary handle; use an explicit rename or human reclaim.",
          );
        this.insert(projectId, targetId, normalization.name);
        return {
          handle: this.lookup(projectId, normalization.name)!,
          normalization,
        };
      })
      .immediate();
  }

  rename(
    projectId: string,
    targetId: string,
    requested: string,
    caller: TrustedCaller,
  ) {
    const normalization = this.name(requested);
    return this.db
      .transaction(() => {
        this.authorize(projectId, targetId, caller);
        const current = this.primary(projectId, targetId);
        if (!current)
          throw new RadioError(
            "not_found",
            "Allocate a handle before renaming it.",
          );
        const occupied = this.lookup(projectId, normalization.name);
        if (occupied && occupied.targetId !== targetId)
          throw new RadioError(
            "conflict",
            "That name is reserved by another identity, including its aliases.",
          );
        this.setPrimary(projectId, targetId, normalization.name);
        return {
          handle: this.lookup(projectId, normalization.name)!,
          normalization,
        };
      })
      .immediate();
  }

  removeAlias(
    projectId: string,
    requested: string,
    caller: TrustedCaller,
  ): void {
    const name = this.name(requested).name;
    this.db
      .transaction(() => {
        const handle = this.lookup(projectId, name);
        if (!handle) throw new RadioError("not_found", "Unknown alias.");
        this.authorize(projectId, handle.targetId, caller);
        if (handle.isPrimary)
          throw new RadioError(
            "invalid_input",
            "A primary handle cannot be removed as an alias.",
          );
        this.db
          .prepare("DELETE FROM handles WHERE project_id = ? AND name = ?")
          .run(projectId, name);
      })
      .immediate();
  }

  reclaim(
    projectId: string,
    targetId: string,
    requested: string,
    caller: TrustedCaller,
  ) {
    const normalization = this.name(requested);
    return this.db
      .transaction(() => {
        this.authorize(projectId, targetId, caller);
        if (caller.kind !== "human")
          throw new RadioError(
            "forbidden",
            "Only the station human can reclaim a handle.",
          );
        const occupied = this.lookup(projectId, normalization.name);
        let displaced: { targetId: string; fallbackName: string } | null = null;
        if (occupied && occupied.targetId !== targetId) {
          // Reclaiming an alias leaves its holder's existing primary name intact.
          const fallbackName = occupied.isPrimary
            ? this.fallback(projectId, occupied.name)
            : this.primary(projectId, occupied.targetId)!.name;
          this.db
            .prepare("DELETE FROM handles WHERE project_id = ? AND name = ?")
            .run(projectId, occupied.name);
          if (occupied.isPrimary)
            this.insert(projectId, occupied.targetId, fallbackName);
          displaced = { targetId: occupied.targetId, fallbackName };
        }
        this.setPrimary(projectId, targetId, normalization.name);
        if (occupied?.targetId !== targetId) {
          this.db
            .prepare(
              "INSERT INTO handle_reassignments(project_id, human_id, target_id, name, displaced_id, fallback_name) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .run(
              projectId,
              caller.actorId,
              targetId,
              normalization.name,
              displaced?.targetId ?? null,
              displaced?.fallbackName ?? null,
            );
        }
        return {
          handle: this.lookup(projectId, normalization.name)!,
          normalization,
          displaced,
        };
      })
      .immediate();
  }

  private authorize(
    projectId: string,
    targetId: string,
    caller: TrustedCaller,
  ) {
    this.projects.get(projectId);
    const target = this.identities.get(targetId);
    const owner = this.identities.get(target.actorId ?? target.id);
    if (
      caller.kind === "human" &&
      this.identities.get(caller.actorId).kind === "human"
    )
      return;
    if (
      caller.kind === "actor" &&
      owner.kind === "actor" &&
      owner.id === caller.actorId
    )
      return;
    if (
      caller.kind === "principal" &&
      owner.kind === "actor" &&
      owner.principalId !== null &&
      owner.principalId === idSchema.parse(caller.principalId)
    )
      return;
    throw new RadioError("forbidden", "Caller does not own this identity.");
  }

  private name(requested: string) {
    const normalized = normalizeName(requested);
    if (normalized.name === "user" || normalized.name === "ch")
      throw new RadioError(
        "invalid_input",
        "The names user and ch are reserved.",
      );
    return normalized;
  }

  private insert(projectId: string, targetId: string, name: string) {
    this.db
      .prepare(
        "INSERT INTO handles(project_id, name, target_id, is_primary) VALUES (?, ?, ?, 1)",
      )
      .run(projectId, name, targetId);
  }

  private setPrimary(projectId: string, targetId: string, name: string) {
    const current = this.primary(projectId, targetId);
    if (current?.name === name) return;
    this.db
      .prepare(
        "UPDATE handles SET is_primary = 0 WHERE project_id = ? AND target_id = ? AND is_primary = 1",
      )
      .run(projectId, targetId);
    this.db
      .prepare(
        "INSERT INTO handles(project_id, name, target_id, is_primary) VALUES (?, ?, ?, 1) ON CONFLICT(project_id, name) DO UPDATE SET is_primary = 1 WHERE target_id = excluded.target_id",
      )
      .run(projectId, name, targetId);
  }

  private fallback(projectId: string, name: string): string {
    for (let suffix = 2; suffix <= 1001; suffix++) {
      const ending = `-${suffix}`;
      const candidate = `${name.slice(0, NAME_MAX - ending.length).replace(/-$/, "")}${ending}`;
      if (!this.lookup(projectId, candidate)) return candidate;
    }
    throw new RadioError(
      "conflict",
      "No bounded fallback candidate is available; choose a different name explicitly.",
    );
  }
}
