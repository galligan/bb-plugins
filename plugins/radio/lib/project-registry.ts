import { createHash, randomUUID } from "node:crypto";
import {
  idSchema,
  type Database,
  type Project,
  type Channel,
} from "./contracts.ts";
import { RadioError } from "./errors.ts";
import { normalizeName } from "./names.ts";

export class ProjectRegistry {
  private db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  get(id: string): Project {
    const row = this.db
      .prepare<[string], Project>(
        "SELECT p.id, p.name, c.id AS channelId FROM projects p JOIN channels c ON c.project_id = p.id AND c.parent_id IS NULL WHERE p.id = ?",
      )
      .get(idSchema.parse(id));
    if (!row) throw new RadioError("not_found", "Unknown project.");
    return row;
  }

  byName(name: string): Project {
    const normalized = normalizeName(name);
    const row = this.db
      .prepare<[string], { id: string }>(
        "SELECT id FROM projects WHERE name = ?",
      )
      .get(normalized.name);
    if (!row) throw new RadioError("not_found", "Unknown project qualifier.");
    return this.get(row.id);
  }

  register(id: string, requested: string) {
    idSchema.parse(id);
    const normalization = normalizeName(requested);
    return this.db
      .transaction(() => {
        const prior = this.db
          .prepare("SELECT id FROM projects WHERE id = ?")
          .get(id);
        if (prior) {
          const project = this.get(id);
          if (project.name !== normalization.name)
            throw new RadioError(
              "conflict",
              "Project is already registered; use an explicit rename.",
            );
          return { project, normalization };
        }
        this.availableProjectName(normalization.name);
        this.db
          .prepare("INSERT INTO projects(id, name) VALUES (?, ?)")
          .run(id, normalization.name);
        this.db
          .prepare(
            "INSERT INTO channels(id, project_id, parent_id, name) VALUES (?, ?, NULL, '')",
          )
          .run(`channel_${randomUUID()}`, id);
        return { project: this.get(id), normalization };
      })
      .immediate();
  }

  /** Verified BB project bootstrap must not depend on a mutable display name. */
  localProject(id: string, displayName: string): Project {
    idSchema.parse(id);
    return this.db
      .transaction(() => {
        const prior = this.db
          .prepare("SELECT id FROM projects WHERE id = ?")
          .get(id);
        if (prior) return this.get(id);
        try {
          return this.register(id, displayName).project;
        } catch (error) {
          if (
            !(error instanceof RadioError) ||
            !["conflict", "invalid_input"].includes(error.code)
          )
            throw error;
        }
        const fallback = `project-${createHash("sha256").update(id).digest("hex").slice(0, 56)}`;
        return this.register(id, fallback).project;
      })
      .immediate();
  }

  rename(id: string, requested: string) {
    const normalization = normalizeName(requested);
    return this.db
      .transaction(() => {
        this.get(id);
        this.availableProjectName(normalization.name, id);
        this.db
          .prepare("UPDATE projects SET name = ? WHERE id = ?")
          .run(normalization.name, id);
        return { project: this.get(id), normalization };
      })
      .immediate();
  }

  channel(id: string): Channel {
    const row = this.db
      .prepare<[string], Channel>(
        "SELECT id, project_id AS projectId, parent_id AS parentId, name FROM channels WHERE id = ?",
      )
      .get(idSchema.parse(id));
    if (!row) throw new RadioError("not_found", "Unknown channel.");
    return row;
  }

  addSubchannel(projectId: string, requested: string) {
    const normalization = normalizeName(requested);
    return this.db
      .transaction(() => {
        const project = this.get(projectId);
        this.availableChannelName(projectId, normalization.name);
        const id = `channel_${randomUUID()}`;
        this.db
          .prepare(
            "INSERT INTO channels(id, project_id, parent_id, name) VALUES (?, ?, ?, ?)",
          )
          .run(id, projectId, project.channelId, normalization.name);
        return { channel: this.channel(id), normalization };
      })
      .immediate();
  }

  renameChannel(id: string, requested: string) {
    const normalization = normalizeName(requested);
    return this.db
      .transaction(() => {
        const channel = this.channel(id);
        if (channel.parentId === null)
          throw new RadioError(
            "invalid_input",
            "Rename the project to change its main channel qualifier.",
          );
        this.availableChannelName(channel.projectId, normalization.name, id);
        this.db
          .prepare("UPDATE channels SET name = ? WHERE id = ?")
          .run(normalization.name, id);
        return { channel: this.channel(id), normalization };
      })
      .immediate();
  }

  resolvePath(path: string): Channel {
    if (typeof path !== "string" || path.length > 513)
      throw new RadioError("invalid_input", "Invalid channel path.");
    const parts = path.split("/");
    if (parts.length < 1 || parts.length > 2 || parts.some((part) => !part))
      throw new RadioError(
        "invalid_input",
        "Use project or project/subchannel.",
      );
    const project = this.byName(parts[0]!);
    if (parts.length === 1) return this.channel(project.channelId);
    const row = this.db
      .prepare<[string, string], { id: string }>(
        "SELECT id FROM channels WHERE project_id = ? AND name = ?",
      )
      .get(project.id, normalizeName(parts[1]!).name);
    if (!row) throw new RadioError("not_found", "Unknown subchannel.");
    return this.channel(row.id);
  }

  private availableProjectName(name: string, except = "") {
    if (name === "ch")
      throw new RadioError(
        "invalid_input",
        "The project qualifier ch is reserved for @ch: addresses.",
      );
    if (
      this.db
        .prepare("SELECT id FROM projects WHERE name = ? AND id != ?")
        .get(name, except)
    )
      throw new RadioError(
        "conflict",
        "Project qualifier is already allocated.",
      );
  }

  private availableChannelName(projectId: string, name: string, except = "") {
    if (
      this.db
        .prepare(
          "SELECT id FROM channels WHERE project_id = ? AND name = ? AND id != ?",
        )
        .get(projectId, name, except)
    )
      throw new RadioError(
        "conflict",
        "Subchannel name is already allocated in this project.",
      );
  }
}
