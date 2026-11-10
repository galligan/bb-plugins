# BB documentation

Run `bun run docs:bb` from the repository root to refresh this reference from the default branch of [get-bb/bb](https://github.com/get-bb/bb). New BB worktrees run it through `.bb-env-setup.sh`; refresh again before plugin development in an existing worktree. Git and network access to GitHub are required. The sync does not install or execute upstream code.

## Reference paths for our skills

These paths are relative to the repository root and become available after a successful sync:

| Topic                               | Local entry point                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Plugin authoring and SDK references | [upstream/plugins/bb-guide/skills/bb-plugin-authoring/SKILL.md](upstream/plugins/bb-guide/skills/bb-plugin-authoring/SKILL.md) |
| BB CLI                              | [upstream/plugins/bb-guide/skills/bb-cli/SKILL.md](upstream/plugins/bb-guide/skills/bb-cli/SKILL.md)                           |
| Writing skills                      | [upstream/plugins/bb-guide/skills/skill-creator/SKILL.md](upstream/plugins/bb-guide/skills/skill-creator/SKILL.md)             |
| Marketplace submission              | [upstream/plugins/bb-guide/skills/submit-a-plugin/SKILL.md](upstream/plugins/bb-guide/skills/submit-a-plugin/SKILL.md)         |
| Provider API                        | [upstream/docs/provider-plugin-api.md](upstream/docs/provider-plugin-api.md)                                                   |
| Provider bridge protocol            | [upstream/docs/provider-bridge-protocol.md](upstream/docs/provider-bridge-protocol.md)                                         |
| Snapshot provenance                 | [upstream/sync.json](upstream/sync.json)                                                                                       |

For example, a repository skill can instruct: “Run `bun run docs:bb`, then read `docs/bb/upstream/plugins/bb-guide/skills/bb-plugin-authoring/SKILL.md` and only the references relevant to the task.” Resolve these paths from the repository root; Markdown links in a skill should use the appropriate relative path from that skill's directory. The mirrored skills are reference documents, not automatically registered skills.

## Freshness and ownership

`upstream/` is an ignored, generated snapshot of upstream `docs/`, `plugins/bb-guide/skills/`, and `LICENSE`. Do not edit it. Put our own conventions in `docs/dev/` and our own skill sources outside the mirror. This covers upstream Markdown documentation and bundled guide skills; it does not scrape the interactive website or generate the CLI manual from application code.

Each refresh uses one shallow checkout of the remote default branch and records its commit, branch, and fetch time in `sync.json`. It preserves upstream directory structure, keeping links between mirrored files local. Markdown links and reference definitions targeting files outside the mirror point to the matching GitHub commit. Code examples and absolute URLs remain unchanged. The upstream license is retained alongside the documentation.

The new copy is prepared before replacing the previous copy, so a failed fetch or transformation leaves the last successful snapshot available and exits nonzero. Concurrent refreshes are rejected. If a process is killed and leaves `docs/bb/.sync/`, inspect it for a `previous/` backup and ensure no refresh is running before removing that temporary directory and retrying.

A successful sync establishes freshness at that moment, not continuously. If offline, report the refresh failure and the existing snapshot's commit/time; do not describe it as current. If there is no snapshot, upstream references are unavailable until a refresh succeeds.

Upstream may be ahead of the installed BB release or a plugin's SDK pin. Check the affected package's installed public declarations and runtime before using an API. This command never updates SDK pins, dependencies, or the running application. Follow [repository verification](../dev/verification.md) for changes here.
