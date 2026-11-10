import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { ValidationError } from "./json.ts";
import type { ModelConfig } from "./contracts.ts";

export type ConnectionType = ModelConfig["connection"];

export function customEndpoint(input: string): string {
  try {
    if (!input || input !== input.trim()) throw new Error();
    const url = new URL(input);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      input.includes("?") ||
      input.includes("#")
    )
      throw new Error();
    let path = url.pathname.replace(/\/+$/, "");
    if (path.endsWith("/v1/systemone/v1/systemone")) throw new Error();
    if (!path.endsWith("/v1/systemone"))
      path += path.endsWith("/v1") ? "/systemone" : "/v1/systemone";
    url.pathname = path;
    return url.toString();
  } catch {
    throw new ValidationError("invalid_endpoint");
  }
}

const keySchema = z
  .string()
  .max(4096)
  .refine((value) => !/[\r\n]/.test(value), "Key must not contain line breaks");
export function defineConnectionSettings(bb: BbPluginApi) {
  return bb.settings.define({
    typesafeApiKey: {
      type: "string",
      secret: true,
      label: "Jev / TypeSafe API key",
      experimental_schema: keySchema,
    },
    cloudflareAccountId: {
      type: "string",
      label: "Cloudflare account ID",
      default: "",
      experimental_schema: z
        .string()
        .regex(
          /^$|^[a-fA-F0-9]{32}$/,
          "Use the 32-character Cloudflare account ID",
        ),
    },
    cloudflareApiToken: {
      type: "string",
      secret: true,
      label: "Cloudflare Workers AI token",
      experimental_schema: keySchema,
    },
    customBaseUrl: {
      type: "string",
      label: "Custom System One URL (localhost is the BB server)",
      default: "",
      experimental_schema: z.string().refine((value) => {
        if (value === "") return true;
        try {
          customEndpoint(value);
          return true;
        } catch {
          return false;
        }
      }, "Use an HTTP(S) root or System One endpoint without credentials, query, or fragment"),
    },
    customApiKey: {
      type: "string",
      secret: true,
      label: "Custom endpoint API key (optional)",
      experimental_schema: keySchema,
    },
  });
}

export type ConnectionSettingsHandle = ReturnType<
  typeof defineConnectionSettings
>;
export type ConnectionSettings = Awaited<
  ReturnType<ConnectionSettingsHandle["get"]>
>;
export const CONNECTION_FIELDS = {
  typesafe: ["typesafeApiKey"],
  cloudflare: ["cloudflareAccountId", "cloudflareApiToken"],
  custom: ["customBaseUrl", "customApiKey"],
} as const;

export type Readiness = {
  status: "configured" | "not_configured";
  code:
    | "ready"
    | "missing_key"
    | "missing_account"
    | "missing_url"
    | "invalid_endpoint";
  nextAction: string;
};

export const probeStatusSchema = z.enum([
  "reachable",
  "authentication_failed",
  "unsupported_model",
  "error",
]);
export type ProbeStatus = z.infer<typeof probeStatusSchema>;
export type ModelCheck = {
  modelId: string;
  status: Readiness["status"] | ProbeStatus | "cancelled";
  code: string;
  nextAction: string;
  tested: boolean;
  latencyMs: number | null;
};

export function connectionReadiness(
  connection: ConnectionType,
  settings: ConnectionSettings,
): Readiness {
  const missing = (code: Readiness["code"], nextAction: string): Readiness => ({
    status: "not_configured",
    code,
    nextAction,
  });
  if (connection === "typesafe" && !settings.typesafeApiKey?.trim())
    return missing(
      "missing_key",
      "Enter the Jev key in Settings → Installed plugins → Judge.",
    );
  if (connection === "cloudflare") {
    if (!/^[a-fA-F0-9]{32}$/.test(settings.cloudflareAccountId))
      return missing(
        "missing_account",
        "Set the Cloudflare account ID in Judge settings.",
      );
    if (!settings.cloudflareApiToken?.trim())
      return missing(
        "missing_key",
        "Enter the Workers AI token in Judge settings.",
      );
  }
  if (connection === "custom") {
    if (!settings.customBaseUrl)
      return missing(
        "missing_url",
        "Set a compatible System One endpoint in Judge settings; localhost is the BB server.",
      );
    try {
      customEndpoint(settings.customBaseUrl);
    } catch {
      return missing(
        "invalid_endpoint",
        "Correct the custom URL in Judge settings.",
      );
    }
  }
  return {
    status: "configured",
    code: "ready",
    nextAction:
      "Run an explicit synthetic model check to verify connectivity; saving settings does not make a request.",
  };
}

/** Server-only transport material. Never return this object through a public surface. */
export function runtimeConnection(
  model: ModelConfig,
  settings: ConnectionSettings,
): { endpoint: string; credential?: string } {
  const connection = model.connection;
  if (connection === "typesafe")
    return {
      endpoint: "https://api.typesafe.ai/v1/systemone",
      credential: settings.typesafeApiKey,
    };
  if (connection === "cloudflare")
    return {
      endpoint: `https://api.cloudflare.com/client/v4/accounts/${settings.cloudflareAccountId}/ai/run/@cf/cloudflare/${model.model}`,
      credential: settings.cloudflareApiToken,
    };
  return {
    endpoint: customEndpoint(settings.customBaseUrl),
    credential: settings.customApiKey,
  };
}

/** Deliberately project only nonsecret endpoint configuration into fingerprints. */
export function publicConnectionIdentity(
  model: ModelConfig,
  settings: ConnectionSettings,
) {
  let endpoint: string | null = null;
  try {
    endpoint = runtimeConnection(model, settings).endpoint;
  } catch {
    /* Invalid custom URL remains unconfigured. */
  }
  return {
    endpoint,
    accountId:
      model.connection === "cloudflare" ? settings.cloudflareAccountId : null,
  };
}
