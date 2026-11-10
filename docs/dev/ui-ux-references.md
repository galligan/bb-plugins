# UI/UX research references

The [UI/UX guide](ui-ux.md) combines public BB contracts, BB's component source, and selected patterns from the local research clones. Research was source-based on 2026-11-10; it did not install or visually certify the reference plugins. Repository-specific preferences, such as choosing additive surfaces first and avoiding duplicate headers, are design defaults rather than claims that the SDK enforces them.

## Primary sources

Start with the affected package's public `@get-bb/plugin-sdk/app` declarations and the [BB Plugin Guide](https://getbb.app/plugin-guide). The installed `bb-plugin-authoring` skill provides focused references:

| Reference                                                             | Use it for                                                                                                       |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `frontend-registration.md`                                            | Host slots, actions, thread Info contributions, and replacement surfaces                                         |
| `frontend-components.md`                                              | Pickers, composers, chat, Markdown, file links, code/diff viewers, and icons                                     |
| `frontend-hooks-and-ui.md`                                            | Registry controls, shared runtimes, themes, portals, notifications, panel control, composer APIs, and live reads |
| `frontend-sidebar-navigation.md`                                      | Host navigation actions, visibility/order, split behavior, and replacement-provider obligations                  |
| `frontend-thread-context-card.md` / `frontend-thread-row-metadata.md` | Context rows and badges without rebuilding the surrounding shell                                                 |
| `testing.md` / `frontend-testing-api-index.md`                        | The SDK harness and its live-UI fidelity limits                                                                  |

The BB source checkout was clean at `a124a8d4f211ae101ceb6f09e99ebaee9cadc011` during inspection. These pinned links make the evidence reproducible; they are not a directive to pin new plugins to that revision:

- [Public app facade](https://github.com/get-bb/bb/blob/a124a8d4f211ae101ceb6f09e99ebaee9cadc011/packages/plugin-sdk/src/app.ts) and [app contract](https://github.com/get-bb/bb/blob/a124a8d4f211ae101ceb6f09e99ebaee9cadc011/packages/plugin-sdk/src/app-contract.ts): runtime-owned exports and version-sensitive surface definitions.
- [Plugin registry](https://github.com/get-bb/bb/tree/a124a8d4f211ae101ceb6f09e99ebaee9cadc011/packages/plugin-registry): the public vendoring path for independently distributed plugins.
- [Button](https://github.com/get-bb/bb/blob/a124a8d4f211ae101ceb6f09e99ebaee9cadc011/packages/shared-ui/src/components/ui/button.tsx): semantic variants, focus styles, disabled behavior, and control geometry.
- [Dialog](https://github.com/get-bb/bb/blob/a124a8d4f211ae101ceb6f09e99ebaee9cadc011/packages/shared-ui/src/components/ui/dialog.tsx) and [portal scope helper](https://github.com/get-bb/bb/blob/a124a8d4f211ae101ceb6f09e99ebaee9cadc011/packages/shared-ui/src/lib/portal-scope.ts): responsive overlays and plugin scope outside the mount root.
- [Coarse-pointer sizing](https://github.com/get-bb/bb/blob/a124a8d4f211ae101ceb6f09e99ebaee9cadc011/packages/shared-ui/src/components/ui/coarse-pointer-sizing.ts): BB's density adjustments for compact touch controls.

These internal source paths explain the design; external plugins must obtain controls through the registry rather than importing those paths. Recheck current SDK and registry availability before copying an API name or updating a recipe.

## Examples and what to learn from them

| Example                                                                                                          | Observed pattern                                                                                                         | Boundary                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| [Worktree+](../../plugins/wt/app.tsx)                                                                            | A narrow provider-input contribution reuses the host branch picker instead of implementing branch search and a new form  | The provider still owns its input value and host-specific default-base request                                              |
| [Graphite registry configuration](../../plugins/graphite/components.json)                                        | UI source is vendored from a release-specific `@bb` registry                                                             | Its older registry and SDK pins are compatibility context, not the current baseline for new UI                              |
| [BB Sidebar](https://github.com/yusuf8834/bb-sidebar/blob/021c2bc33ec2e69a2d46622912be1610456e7e51/app.tsx)      | A replacement list supplies parent/child navigation where its different organization would otherwise hide it             | A sidebar replacement inherits navigation obligations; this is not a reason to replace the sidebar for a small feature      |
| [Bots Sidebar](https://github.com/tobi/bb-bots-sidebar/blob/f239974f8a7e1417f46ff1fdab8de7a54514d321/app.tsx)    | Uses host thread menus, titles, sidebar hooks, navigation, and vendored controls within a different organization model   | Do not copy its dense dimensions or custom launch flows without checking the current host alternatives and compact behavior |
| [Handoff](https://github.com/vburojevic/bb-plugin-handoff/blob/10e0e91dac44ceb179f6f33c44ed4baf5492b32e/app.tsx) | Composes a task in a thread panel with registry controls, BB Markdown, shared toasts, and explicit coarse-pointer sizing | Its registry pin is older; reuse the task structure, then select controls compatible with our package                       |
| [Linear](https://github.com/vburojevic/bb-plugin-linear/blob/62d2401baf920301c37bc60744d60dc092eb8500/app.tsx)   | Uses `navPanel` header actions and avoids repeating the host's section title inside the connection card                  | The source contains version-specific context-slot names; look up the current slot contract rather than copying them blindly |

The external Linear example is `vburojevic/bb-plugin-linear`, not this repository's `plugins/linear`. The reference clones live under ignored `repos/` and can be populated through the [research script](../../README.md#reference-plugins). The progressive-skill reference did not supply a comparable frontend example for this guide.
