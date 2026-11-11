export const project = {
  id: "proj_one",
  name: "one",
  channelId: "channel_main",
};
export const identity = (human = false, sessionId = "thr_pick") => ({
  stationId: "station_one",
  actorId: human ? "human_one" : "actor_one",
  sessionId: human ? null : sessionId,
  project,
  handle: null,
});
export function attention(
  input: {
    after: number;
    requiredAfter: { cursor: number; targetId: string };
    commitmentAfter: number;
  },
  human = false,
) {
  const actor = human ? "human_one" : "actor_one";
  const discovery = input.after
    ? []
    : [
        {
          id: "tx_discovery",
          cursor: 1,
          body: "Discovery only",
          channelId: project.channelId,
          authorId: "actor_other",
          createdAt: "2026-11-10T23:00:00Z",
        },
      ];
  const required = input.requiredAfter.cursor
    ? []
    : [
        {
          txId: "tx_request",
          cursor: 7,
          targetId: actor,
          needAck: true,
          needReply: false,
        },
        {
          txId: "tx_request",
          cursor: 7,
          targetId: "thr_pick",
          needAck: false,
          needReply: true,
        },
        {
          txId: "tx_old",
          cursor: 8,
          targetId: "thr_other",
          needAck: true,
          needReply: true,
        },
      ];
  const scopedRequired = human
    ? required.filter((item) => item.targetId === actor)
    : required;
  const commitments = input.commitmentAfter
    ? []
    : [
        {
          id: "commit_one",
          cursor: 4,
          txId: "tx_work",
          targetId: actor,
          ownerActorId: actor,
          openingSessionId: human ? null : "thr_pick",
          generation: 0,
          status: "open",
          openedAt: "2026-11-10T23:00:00Z",
          closedAt: null,
          result: null,
          reason: null,
        },
      ];
  return {
    discovery: { items: discovery, nextCursor: 1, hasMore: !input.after },
    required: {
      items: scopedRequired,
      nextCursor: human
        ? { cursor: 7, targetId: actor }
        : { cursor: 8, targetId: "thr_other" },
      hasMore: !input.requiredAfter.cursor,
    },
    commitments: {
      items: commitments,
      nextCursor: 4,
      hasMore: !input.commitmentAfter,
    },
    pageCounts: {
      discovery: discovery.length,
      required: scopedRequired.length,
      commitments: commitments.length,
    },
  };
}
