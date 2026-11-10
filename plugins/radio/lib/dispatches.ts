import { randomUUID } from "node:crypto";
import type { Database } from "./contracts.ts";
import type { RadioStore } from "./storage.ts";
import type { AddressScope } from "./address-resolution.ts";
import type { TransmissionContext } from "./transmission-contracts.ts";
import { requireAuthor, requireChannel } from "./transmission-access.ts";
import { RadioError } from "./errors.ts";
import {
  createDispatchSchema,
  reviseDispatchSchema,
  readDispatchSchema,
  listDispatchSchema,
  parseDispatch,
  validateMarkdown,
  type DispatchRevision,
} from "./dispatch-contracts.ts";

type Domain = Pick<RadioStore, "stationId" | "identities" | "projects">;
type DocumentRow = {
  id: string;
  cursor: number;
  channelId: string;
  authorId: string;
  latest: number;
};
type RevisionRow = Omit<
  DispatchRevision,
  "stationId" | "id" | "channelId" | "authorId"
>;
type ReplayRow = {
  operation: string;
  request: string;
  id: string;
  revision: number;
};

export class Dispatches {
  private db: Database;
  private store: Domain;
  constructor(db: Database, store: Domain) {
    this.db = db;
    this.store = store;
  }

  create(context: TransmissionContext, input: unknown) {
    const request = parseDispatch(createDispatchSchema, input);
    validateMarkdown(request.markdown);
    const callerKey = requireAuthor(this.store.identities, context);
    const requestJson = JSON.stringify({
      sessionId: context.sessionId ?? null,
      ...request,
    });
    return this.db
      .transaction(() => {
        requireChannel(this.store.projects, request.channelId, context.scope);
        const replay = this.replay(
          callerKey,
          request.idempotencyKey,
          "create",
          requestJson,
          context.scope,
        );
        if (replay) return { replayed: true, dispatch: replay };
        const id = `dispatch_${randomUUID()}`;
        this.db
          .prepare(
            "INSERT INTO dispatches(id, channel_id, author_id, latest) VALUES (?, ?, ?, 1)",
          )
          .run(id, request.channelId, context.authorId);
        this.insertRevision(id, 1, context, request.title, request.markdown);
        this.bind(
          callerKey,
          request.idempotencyKey,
          "create",
          requestJson,
          id,
          1,
        );
        return {
          replayed: false,
          dispatch: this.get(context.scope, { id, revision: 1 }),
        };
      })
      .immediate();
  }

  revise(context: TransmissionContext, input: unknown) {
    const request = parseDispatch(reviseDispatchSchema, input);
    validateMarkdown(request.markdown);
    const callerKey = requireAuthor(this.store.identities, context);
    const requestJson = JSON.stringify({
      sessionId: context.sessionId ?? null,
      ...request,
    });
    return this.db
      .transaction(() => {
        const document = this.document(request.id, context.scope);
        if (
          document.authorId !== context.authorId &&
          this.store.identities.get(context.authorId).kind !== "human"
        )
          throw new RadioError(
            "forbidden",
            "Only the dispatch author or station human may revise it.",
          );
        const replay = this.replay(
          callerKey,
          request.idempotencyKey,
          "revise",
          requestJson,
          context.scope,
        );
        if (replay) return { replayed: true, dispatch: replay };
        if (request.expectedRevision !== document.latest)
          throw new RadioError(
            "conflict",
            `Dispatch changed; expected revision ${request.expectedRevision}, current revision ${document.latest}.`,
          );
        const revision = document.latest + 1;
        this.insertRevision(
          document.id,
          revision,
          context,
          request.title,
          request.markdown,
        );
        this.db
          .prepare("UPDATE dispatches SET latest = ? WHERE id = ?")
          .run(revision, document.id);
        this.bind(
          callerKey,
          request.idempotencyKey,
          "revise",
          requestJson,
          document.id,
          revision,
        );
        return {
          replayed: false,
          dispatch: this.get(context.scope, { id: document.id, revision }),
        };
      })
      .immediate();
  }

  get(scope: AddressScope, input: unknown): DispatchRevision {
    const request = parseDispatch(readDispatchSchema, input);
    const document = this.document(request.id, scope);
    const row = this.db
      .prepare<[string, number], RevisionRow>(
        `SELECT revision, title, markdown,
      editor_id AS editorId, session_id AS sessionId, created_at AS createdAt
      FROM dispatch_revisions WHERE dispatch_id = ? AND revision = ?`,
      )
      .get(document.id, request.revision ?? document.latest);
    if (!row) throw new RadioError("not_found", "Unknown dispatch revision.");
    return {
      stationId: this.store.stationId,
      id: document.id,
      channelId: document.channelId,
      authorId: document.authorId,
      ...row,
    };
  }

  list(scope: AddressScope, input: unknown) {
    const { channelId, after, limit } = parseDispatch(
      listDispatchSchema,
      input,
    );
    requireChannel(this.store.projects, channelId, scope);
    const rows = this.db
      .prepare<
        [string, number, number],
        { cursor: number; id: string; revision: number; title: string }
      >(
        `SELECT d.seq AS cursor, d.id, d.latest AS revision, r.title FROM dispatches d
       JOIN dispatch_revisions r ON r.dispatch_id = d.id AND r.revision = d.latest
       WHERE d.channel_id = ? AND d.seq > ? ORDER BY d.seq LIMIT ?`,
      )
      .all(channelId, after, limit + 1);
    const items = rows.slice(0, limit);
    return {
      items,
      nextCursor: items.at(-1)?.cursor ?? after,
      hasMore: rows.length > limit,
    };
  }

  private document(id: string, scope: AddressScope): DocumentRow {
    const row = this.db
      .prepare<[string], DocumentRow>(
        "SELECT id, seq AS cursor, channel_id AS channelId, author_id AS authorId, latest FROM dispatches WHERE id = ?",
      )
      .get(id);
    if (!row)
      throw new RadioError("not_found", "Unknown or inaccessible dispatch.");
    requireChannel(this.store.projects, row.channelId, scope);
    return row;
  }

  private replay(
    callerKey: string,
    key: string,
    operation: string,
    requestJson: string,
    scope: AddressScope,
  ) {
    const row = this.db
      .prepare<[string, string], ReplayRow>(
        "SELECT operation, request_json AS request, dispatch_id AS id, revision FROM dispatch_requests WHERE caller_key = ? AND idempotency_key = ?",
      )
      .get(callerKey, key);
    if (!row) return null;
    if (row.operation !== operation || row.request !== requestJson)
      throw new RadioError(
        "conflict",
        "Idempotency key is bound to a different dispatch request.",
      );
    return this.get(scope, { id: row.id, revision: row.revision });
  }

  private bind(
    callerKey: string,
    key: string,
    operation: string,
    requestJson: string,
    id: string,
    revision: number,
  ) {
    this.db
      .prepare(
        "INSERT INTO dispatch_requests(caller_key, idempotency_key, operation, request_json, dispatch_id, revision) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(callerKey, key, operation, requestJson, id, revision);
  }

  private insertRevision(
    id: string,
    revision: number,
    context: TransmissionContext,
    title: string,
    markdown: string,
  ) {
    this.db
      .prepare(
        "INSERT INTO dispatch_revisions(dispatch_id, revision, title, markdown, editor_id, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        revision,
        title,
        markdown,
        context.authorId,
        context.sessionId ?? null,
        new Date().toISOString(),
      );
  }
}
