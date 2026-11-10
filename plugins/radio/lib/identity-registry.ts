import { randomUUID } from "node:crypto";
import {
  externalReportSchema,
  idSchema,
  metadataSchema,
  type Database,
  type Participant,
  type SessionMetadata,
} from "./contracts.ts";
import { RadioError } from "./errors.ts";

type ParticipantRow = Omit<Participant, "stationId" | "metadata"> & {
  metadataJson: string;
};
const COLUMNS =
  "id, kind, actor_id AS actorId, principal_id AS principalId, external_id AS externalId, metadata_json AS metadataJson, provenance";

export class IdentityRegistry {
  private db: Database;
  readonly stationId: string;
  constructor(db: Database, stationId: string) {
    this.db = db;
    this.stationId = stationId;
  }

  get(id: string): Participant {
    const row = this.db
      .prepare<[string], ParticipantRow>(
        `SELECT ${COLUMNS} FROM participants WHERE id = ?`,
      )
      .get(idSchema.parse(id));
    if (!row) throw new RadioError("not_found", "Unknown participant.");
    const { metadataJson, ...value } = row;
    return {
      ...value,
      stationId: this.stationId,
      metadata: metadataSchema.parse(JSON.parse(metadataJson)),
    };
  }

  human(): Participant {
    return this.db
      .transaction(() => {
        const row = this.db
          .prepare<[], { id: string }>(
            "SELECT id FROM participants WHERE kind = 'human'",
          )
          .get();
        return row ? this.get(row.id) : this.insert("human", { name: "User" });
      })
      .immediate();
  }

  createActor(metadata: SessionMetadata = {}): Participant {
    return this.insert("actor", metadataSchema.parse(metadata));
  }

  registerThread(
    threadId: string,
    actorId: string,
    metadata: SessionMetadata = {},
  ): Participant {
    if (!/^thr_[a-zA-Z0-9]+$/.test(idSchema.parse(threadId)))
      throw new RadioError("invalid_input", "Use the existing BB thread ID.");
    const parsed = metadataSchema.parse(metadata);
    return this.db
      .transaction(() => {
        this.requireActor(actorId);
        const prior = this.db
          .prepare("SELECT id FROM participants WHERE id = ?")
          .get(threadId);
        if (prior) {
          const value = this.get(threadId);
          if (value.kind !== "bb-thread" || value.actorId !== actorId)
            throw new RadioError(
              "conflict",
              "Thread ownership is already registered; it cannot be changed by registration.",
            );
          this.db
            .prepare("UPDATE participants SET metadata_json = ? WHERE id = ?")
            .run(JSON.stringify(parsed), threadId);
          return this.get(threadId);
        }
        return this.insert("bb-thread", parsed, {
          id: threadId,
          actorId,
          provenance: "bb",
        });
      })
      .immediate();
  }

  /** The adapter supplies trusted principal context separately from self-report data. */
  registerExternal(
    context: { principalId: string },
    report: unknown,
  ): Participant {
    const principalId = idSchema.parse(context.principalId);
    const { sessionId, ...metadata } = externalReportSchema.parse(report);
    return this.db
      .transaction(() => {
        const actor = this.db
          .prepare<[string], { id: string }>(
            "SELECT id FROM participants WHERE kind = 'actor' AND principal_id = ?",
          )
          .get(principalId);
        const actorId =
          actor?.id ??
          this.insert("actor", metadata, {
            principalId,
            provenance: "self-reported",
          }).id;
        if (sessionId) {
          const prior = this.db
            .prepare<[string, string], { id: string }>(
              "SELECT id FROM participants WHERE kind = 'external-session' AND principal_id = ? AND external_id = ?",
            )
            .get(principalId, sessionId);
          if (prior) {
            this.db
              .prepare("UPDATE participants SET metadata_json = ? WHERE id = ?")
              .run(JSON.stringify(metadata), prior.id);
            return this.get(prior.id);
          }
        }
        return this.insert("external-session", metadata, {
          actorId,
          principalId,
          externalId: sessionId ?? null,
          provenance: "self-reported",
        });
      })
      .immediate();
  }

  requireActor(id: string): Participant {
    const participant = this.get(id);
    if (participant.kind !== "human" && participant.kind !== "actor")
      throw new RadioError(
        "invalid_input",
        "Session ownership requires an actor ID.",
      );
    return participant;
  }

  private insert(
    kind: Participant["kind"],
    metadata: SessionMetadata,
    fields: {
      id?: string;
      actorId?: string;
      principalId?: string;
      externalId?: string | null;
      provenance?: Participant["provenance"];
    } = {},
  ): Participant {
    const id =
      fields.id ??
      `${kind === "human" || kind === "actor" ? "actor" : "session"}_${randomUUID()}`;
    this.db
      .prepare(
        "INSERT INTO participants(id, kind, actor_id, principal_id, external_id, metadata_json, provenance) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        kind,
        fields.actorId ?? null,
        fields.principalId ?? null,
        fields.externalId ?? null,
        JSON.stringify(metadata),
        fields.provenance ?? "station",
      );
    return this.get(id);
  }
}
