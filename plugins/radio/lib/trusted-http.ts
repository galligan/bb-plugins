import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { externalReportSchema, idSchema } from "./contracts.ts";
import type { RadioStore } from "./storage.ts";
import type { TransmissionContext } from "./transmission-contracts.ts";
import { operationSchema } from "./operation-contracts.ts";
import { RadioOperations } from "./operations.ts";
import { executeSurface, surfaceFailure } from "./surface-result.ts";
import type { SurfaceResult } from "./surface-contract.ts";
import { readHttpJson } from "./http-json.ts";
import { RadioError } from "./errors.ts";

const callSchema = z
  .object({ sessionId: idSchema, request: operationSchema })
  .strict();
export function registerTrustedHttp(bb: BbPluginApi, store: RadioStore) {
  const settings = bb.settings.define({
    trustedTestEnabled: {
      type: "boolean",
      label: "Enable trusted-test HTTP (no outside credentials)",
      default: false,
    },
    trustedTestProject: { type: "project", label: "Trusted-test HTTP project" },
  });
  const lifecycle = new AbortController();
  let configuration = new AbortController();
  settings.onChange((next, previous) => {
    if (
      next.trustedTestEnabled !== previous.trustedTestEnabled ||
      next.trustedTestProject !== previous.trustedTestProject
    ) {
      configuration.abort();
      configuration = new AbortController();
    }
  });
  bb.onDispose(() => lifecycle.abort());
  const principalId = `trusted-test:${store.stationId}`;
  const operations = new RadioOperations(bb.storage.database(), store);
  const invalidate = () => bb.rpc.experimental_invalidate(["radio"]);

  async function projectContext(signal: AbortSignal) {
    const initial = await settings.get();
    if (!initial.trustedTestEnabled || !initial.trustedTestProject)
      throw new RadioError(
        "forbidden",
        "Trusted-test HTTP is disabled or has no configured project.",
      );
    const project = await bb.sdk.projects.get({
      projectId: initial.trustedTestProject,
      signal,
    });
    signal.throwIfAborted();
    const current = await settings.get();
    signal.throwIfAborted();
    if (
      !current.trustedTestEnabled ||
      current.trustedTestProject !== project.id
    )
      throw new RadioError(
        "forbidden",
        "Trusted-test configuration changed; retry explicitly.",
      );
    return store.projects.localProject(project.id, project.name);
  }

  const register = async (
    request: Request,
    signal: AbortSignal,
  ): Promise<SurfaceResult> => {
    const input = externalReportSchema.safeParse(
      await readHttpJson(request, signal, 16384),
    );
    if (!input.success)
      throw new RadioError(
        "invalid_input",
        "Use only bounded self-reported session metadata; identity and operator claims are not accepted.",
      );
    const project = await projectContext(signal);
    signal.throwIfAborted();
    const session = store.identities.registerExternal(
      { principalId },
      input.data,
    );
    const context: TransmissionContext = {
      caller: { kind: "principal", principalId },
      authorId: session.actorId!,
      sessionId: session.id,
      scope: { projectIds: [project.id], currentProjectId: project.id },
    };
    invalidate();
    return {
      ok: true,
      data: z.json().parse({
        session,
        project,
        authentication: "trusted-test-shared-principal-no-credentials",
      }),
      attention: operations.hint(context),
    };
  };
  const call = async (
    request: Request,
    signal: AbortSignal,
  ): Promise<SurfaceResult> => {
    const input = callSchema.safeParse(await readHttpJson(request, signal));
    if (!input.success)
      throw new RadioError(
        "invalid_input",
        "Use a canonical external sessionId and a validated Radio request; caller/operator claims are not accepted.",
      );
    const project = await projectContext(signal);
    signal.throwIfAborted();
    const session = store.identities.get(input.data.sessionId);
    if (
      session.kind !== "external-session" ||
      session.principalId !== principalId ||
      !session.actorId
    )
      throw new RadioError(
        "forbidden",
        "This trusted-test endpoint cannot act for BB, human or foreign-principal identities.",
      );
    const context: TransmissionContext = {
      caller: { kind: "principal", principalId },
      authorId: session.actorId,
      sessionId: session.id,
      scope: { projectIds: [project.id], currentProjectId: project.id },
    };
    return executeSurface(
      operations,
      context,
      input.data.request,
      invalidate,
      signal,
    );
  };
  for (const [path, handler] of [
    ["/trusted/register", register],
    ["/trusted/call", call],
  ] as const) {
    bb.http.route(
      "POST",
      path,
      async (context) => {
        const signal = AbortSignal.any([
          context.req.raw.signal,
          lifecycle.signal,
          configuration.signal,
          AbortSignal.timeout(10000),
        ]);
        let result: SurfaceResult;
        try {
          const current = await settings.get();
          signal.throwIfAborted();
          if (!current.trustedTestEnabled || !current.trustedTestProject)
            throw new RadioError(
              "forbidden",
              "Trusted-test HTTP is disabled or has no configured project.",
            );
          result = await handler(context.req.raw, signal);
        } catch (error) {
          result = surfaceFailure(signal.aborted ? signal.reason : error);
        }
        const status = result.ok
          ? 200
          : (
              {
                invalid_input: 400,
                not_found: 404,
                conflict: 409,
                forbidden: 403,
                ambiguous: 422,
                aborted: 499,
                internal_error: 500,
              } as const
            )[result.error.code];
        return new Response(JSON.stringify(result), {
          status,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      },
      { auth: "local" },
    );
  }
}
