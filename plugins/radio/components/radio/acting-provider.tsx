import { useLocalRead } from "./use-local-read.ts";
import { AttentionPanel } from "./attention-panel.tsx";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  experimental_useRpcMutation,
  experimental_useTabVisible,
} from "@get-bb/plugin-sdk/app";
import { rpcContract, type SurfaceResult } from "../../lib/surface-contract.ts";
import {
  ActingContext,
  identitySchema,
  type ActingIdentity,
  type ActingState,
  type OperationInput,
} from "./acting-context.ts";
import { ActingControls } from "./acting-controls.tsx";
import { ReadStatus } from "./status.tsx";

const failure = (message: string): SurfaceResult => ({
  ok: false,
  error: { code: "forbidden", message, choices: [] },
});
export function ActingProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<ActingState["mode"]>("browse");
  const [threadId, setThreadId] = useState("");
  const [identity, setIdentity] = useState<ActingIdentity | null>(null);
  const [operatorSecret, setOperatorSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = experimental_useRpcMutation({
    contract: rpcContract,
    method: "call",
  });
  const visible = experimental_useTabVisible();
  const generation = useRef(0);
  const selection = useRef({ mode, threadId });
  selection.current = { mode, threadId };
  const lock = useCallback(() => {
    generation.current++;
    setOperatorSecret("");
    setIdentity(null);
    setMode("browse");
    setThreadId("");
    setError(null);
  }, []);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    if (!visible && mode === "operator") lock();
  }, [visible, mode, lock]);
  const setThreadIdentity = useCallback(
    (id: string, value: ActingIdentity | null) => {
      if (
        selection.current.mode === "thread" &&
        selection.current.threadId === id
      )
        setIdentity(value);
    },
    [],
  );
  const perform = async (request: OperationInput): Promise<SurfaceResult> => {
    if (!identity)
      return failure(
        "Choose a verified acting thread or unlock operator mode first.",
      );
    const context =
      mode === "operator"
        ? { projectId, asUser: true, operatorCredential: operatorSecret }
        : mode === "thread" && identity.sessionId === threadId
          ? { projectId, threadId }
          : null;
    if (!context)
      return failure(
        "The acting identity changed. Select it again before submitting.",
      );
    try {
      return await mutation.mutate({ context, request });
    } catch {
      return {
        ok: false,
        error: {
          code: "internal_error",
          message:
            "Radio did not confirm the operation. Inspect history or retry the original request; no delivery is implied.",
          choices: [],
        },
      };
    }
  };
  async function unlock(credential: string) {
    const attempt = ++generation.current;
    setError(null);
    try {
      const result = await mutation.mutate({
        context: { projectId, asUser: true, operatorCredential: credential },
        request: { op: "whoami", input: {} },
      });
      if (
        attempt !== generation.current ||
        selection.current.mode !== "operator"
      )
        return;
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      const parsed = identitySchema.safeParse(result.data);
      if (!parsed.success) {
        setError("Radio returned an unsupported identity.");
        return;
      }
      setOperatorSecret(credential);
      setIdentity(parsed.data);
    } catch {
      if (attempt === generation.current)
        setError("Operator verification was not confirmed. Retry explicitly.");
    }
  }
  const changeMode = (next: ActingState["mode"]) => {
    generation.current++;
    setMode(next);
    setThreadId("");
    setIdentity(null);
    setOperatorSecret("");
    setError(null);
  };
  return (
    <ActingContext.Provider
      value={{
        projectId,
        mode,
        threadId,
        identity,
        pending: mutation.isPending,
        perform,
      }}
    >
      <ActingControls
        projectId={projectId}
        mode={mode}
        threadId={threadId}
        identity={identity}
        pending={mutation.isPending}
        operatorUnlocked={!!operatorSecret}
        error={error}
        onMode={changeMode}
        onThread={(id) => {
          generation.current++;
          setThreadId(id);
          setIdentity(null);
          setError(null);
        }}
        onLock={lock}
        onUnlock={(credential) => void unlock(credential)}
        threadVerification={
          mode === "thread" && threadId ? (
            <ThreadIdentity
              key={threadId}
              projectId={projectId}
              threadId={threadId}
              onIdentity={setThreadIdentity}
            />
          ) : null
        }
      />
      <AttentionPanel />
      {children}
    </ActingContext.Provider>
  );
}
function ThreadIdentity({
  projectId,
  threadId,
  onIdentity,
}: {
  projectId: string;
  threadId: string;
  onIdentity: (id: string, value: ActingIdentity | null) => void;
}) {
  const query = useLocalRead(
    projectId,
    threadId,
    { op: "whoami", input: {} },
    identitySchema,
  );
  useEffect(() => {
    if (query.data) onIdentity(threadId, query.data);
  }, [onIdentity, threadId, query.data]);
  useEffect(() => () => onIdentity(threadId, null), [onIdentity, threadId]);
  return (
    <ReadStatus
      loading={query.isLoading}
      refreshing={query.isFetching && !query.isLoading}
      error={query.error}
      retry={query.refetch}
    />
  );
}
