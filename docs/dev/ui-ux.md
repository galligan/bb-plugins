# Plugin UI and UX

A plugin should feel like another part of BB: familiar controls, the same navigation and keyboard behavior, and a clear purpose within the surrounding screen. These are this repository's design defaults. Start with an existing BB surface and capability, then add only the behavior specific to the plugin.

The API names below were checked against the installed authoring references on 2026-11-10. Verify availability against the affected package's SDK pin before implementation; older plugins may use compatibility names. [Research references](ui-ux-references.md) identify the source and examples behind these recommendations.

## Reuse in this order

1. **An existing host-rendered contribution.** Add a thread action, Info row, composer menu item, or provider input to the place where the person is already working. Let BB own its placement, keyboard handling, and compact presentation.
2. **A public BB capability component.** Use the host's branch picker, model picker, composer, chat, file viewer, or link. These components encapsulate state and policy as well as appearance.
3. **BB registry controls.** Vendor the matching `@bb` shadcn recipes for buttons, inputs, menus, dialogs, and other plugin-owned UI. Preserve their support files and host integration.
4. **A small composition of those pieces.** Write custom layout or domain-specific content when the existing surfaces cannot express the task. Explain what is missing before introducing another renderer, icon library, overlay system, or full-screen application shell.

Reusing BB's internal source as a runtime import is not an option for these independently distributed packages. Use public SDK exports or vendored registry components; do not import `@bb/shared-ui` from a standalone plugin.

## Pick the smallest suitable surface

| User need                                                 | Default surface                                                                       | What to preserve                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Perform an operation on a thread                          | `experimental_threadAction`                                                           | BB's thread menus, compact long-press presentation, action grouping, and customization              |
| Show passive thread facts                                 | Info row/section; thread-context contribution when relevant to the next prompt        | Existing section and row components; hide truly absent context without leaving empty chrome         |
| Inspect a thread-related object or complete a longer task | Registered side-panel tab via `experimental_useAppPanel`                              | BB's tab strip, panel toggle, selection, and close behavior                                         |
| Add prompt content or a submission option                 | Composer `plusMenu` / `sendMenu`, or a scoped composer action                         | The originating composer's draft, attachments, focus, and queue/steer semantics                     |
| Configure an environment provider                         | `experimental_environmentProviderInputs` and host pickers                             | Selected project/host, validation, ready/blocked state, and launch policy                           |
| Browse a plugin's independent collection                  | `navPanel`, with host `headerContent` for header actions                              | The existing title bar and navigation; do not draw a second app shell                               |
| Change plugin preferences or connection settings          | Declared settings and, if needed, `settingsSection`                                   | Existing settings navigation, labels, validation, and secret handling                               |
| Change how the sidebar itself is organized                | Sidebar thread-list or navigation provider, only when that replacement is the feature | All host actions, other plugin entries, keyboard/split affordances, and user selection of providers |

Prefer additive contributions. Sidebar list and navigation providers are replacement surfaces with broader obligations; replacing one merely to add a button makes the plugin responsible for behavior BB already supplies. Keep a plugin's own terminology within its content rather than renaming BB's Thread, Project, or Environment concepts throughout the host.

## Reuse behavior as well as appearance

| Capability                                   | Reuse                                                                                                |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Branch, provider/model, or permission choice | `experimental_BranchPicker`, `experimental_ProviderModelPicker`, `experimental_PermissionModePicker` |
| Create a thread with an editable prompt      | `experimental_NewThreadComposer`; forward its resolved request to `useSdk().threads.spawn`           |
| Display or interact with a conversation      | `ThreadChat` and the host composer APIs                                                              |
| Render message content, source, or a diff    | `Markdown`, `experimental_SourceCode`, `experimental_Diff`                                           |
| Open links or files                          | `UrlLink`, `experimental_FileLink`, and `useBbNavigate`                                              |
| Copy or download content                     | `experimental_copyToClipboard`, `experimental_saveFile`                                              |
| Open or select a panel tab                   | `experimental_useAppPanel` and registered tabs                                                       |
| Archive/delete a thread                      | BB's thread action/menu components, preserving confirmation, descendants, pane cleanup, and Undo     |

Use host routing instead of hard-coded BB URLs, direct `window.location` changes, or a second router. Links should remain real anchors with modifier-click and copy-link behavior. File targets must carry the actual host/environment/thread identity; the browser's machine may not own the file.

Use `useComposer()` to insert or replace prompt content rather than editing the composer DOM. Preserve structured mentions and attachments when changing a draft. `experimental_NewThreadComposer` is a separate create-thread surface: its `default*` props seed user selections, and generic `useComposer()` writes do not reach that instance. Give it enough width for the real controls; do not squeeze it into a narrow sidebar or replace it with a textarea that loses provider and environment behavior.

Host actions sometimes return acceptance rather than completion. For example, opening a file or starting a download does not prove the OS completed it. Match success feedback to the result actually reported.

## Controls, themes, and overlays

New plugin scaffolds supply a `components.json` whose `@bb` registry matches the running BB release. From the plugin directory, add only the components needed, for example:

```sh
bunx shadcn add @bb/button @bb/dialog @bb/tooltip
```

Review the vendored files and dependency changes. Keep the `@/` aliases, portal-scope helper, responsive overlay helpers, and related dependencies together. An existing plugin's registry URL may point to an older release; updating it is a deliberate compatibility change, not a reason to overwrite every component with the newest recipe.

- Use semantic theme classes such as `bg-background`, `bg-card`, `bg-popover`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-state-hover`, and `text-destructive`. Pair surfaces with their intended foreground tokens. Do not introduce a second palette through fixed gray values or custom `@theme` colors. Domain artwork can retain its colors, but must remain legible in the surrounding theme.
- Keep the host's typography, spacing, border, radius, and control variants. Match the adjacent BB surface rather than inventing a universal pixel size: a compact thread row and an editing form have different density needs. Avoid adding cards, shadows, or repeated headings around content the host already frames.
- Use the registry's `Icon` wrapper or public `experimental_Icon`, and `experimental_ProviderIcon` for provider artwork. Use inherited color and the appropriate control-sized glyph. Do not add a second general-purpose icon set merely to reproduce BB's icons.
- Use the registry's dialog, popover, select, and menu recipes. The BB dialog adapts to a compact drawer; the portal helpers retain plugin CSS scope and desktop pointer handling when an overlay leaves the plugin root. Do not repair missing portal styles with global selectors or arbitrary z-index escalation.
- Use `toast` from `sonner`; BB supplies the shared toaster. Do not mount another `<Toaster>`. Keep field-specific validation beside the field and persistent failures in the affected surface; a toast alone is insufficient when recovery is still required.
- Build with `bb plugin build` so React, the SDK, and supported overlay/toast packages use BB's shared runtime. A plugin bundle is not a standalone React app with its own root and global providers.

## Interaction and state

Give the surface a visible primary action when there is a task to complete. Use concrete verbs such as “Open issue” or “Save settings”; show the relevant thread, project, or destination when an action changes it. Keep implementation details such as RPC names and internal ids in diagnostics rather than ordinary product copy.

Distinguish first load, empty results, filtering with no matches, missing configuration, unavailable host, failure, and an update in progress. An empty list after a failed request must not look like a successful “nothing here” result. Provide a useful next step: clear the filter, configure the connection, retry the read, or choose an available host.

Keep already loaded content visible during background refresh and retain form input when saving fails. Disable duplicate submissions while a mutation is pending, with progress close to the initiating action. Do not add automatic retries for writes that may already have succeeded. For plugin-owned data, use the public query/mutation and invalidation contracts supported by the SDK pin before introducing custom polling or a parallel cache. Hidden panel tabs can remain mounted; pause work that exists solely to feed an invisible tab.

`experimental_useTabVisible()` answers that for a panel tab only. It is false everywhere else, including a nav panel, so reads gated on it there never start and the page stays on its loading state. On a nav panel, pause on the browser document's visibility instead, as [Radio's hook](../../plugins/radio/components/radio/use-radio-visible.ts) and [Worktree+'s panel](../../plugins/wt/components/worktrees-panel.tsx) do. The test harness answers the hook with `true` unless a test says otherwise, which hides the mistake: render a nav panel with `tabVisible: false`, as [Radio's reader test](../../plugins/radio/tests/reader-panel.test.tsx) does.

Read BB-owned state through public host hooks and `useSdk()`. Use plugin RPC for secrets, plugin storage, and host work. Do not recreate provider catalogs, permissions policy, thread lifecycle state, or sidebar status from heuristics when BB already exposes the decision.

## Accessibility and compact layouts

- Keep native button, link, input, and list semantics. Give icon-only controls accessible names; tooltips supplement names and do not replace them. Preserve visible focus, Enter/Space activation, Escape dismissal, and focus return after closing an overlay.
- Keep menu triggers and row actions reachable by keyboard and touch. A hover-only operation needs a visible or menu-based alternative. Drag-and-drop needs an equivalent menu or keyboard action for the same task.
- Use the registry's coarse-pointer sizing helpers where the surrounding BB surface uses them. A compact desktop button does not automatically become touch-friendly because it came from the registry. Respect available panel width, long names, wrapping, and scrolling without shrinking text to fit.
- Use labels and icons alongside color to express status. Preserve descriptions for blocked or destructive actions. Avoid grabbing focus on background refresh or announcing every passive update.
- Use the host's motion patterns and reduced-motion behavior. Do not make decorative animation necessary to understand state or complete a task.

## UI review and verification

For a UI change, state which host surface and existing component/recipe it reuses. If custom UI is needed, identify the capability missing from those options. This is a design explanation in the PR, not a new approval gate.

Cover behavior with `@get-bb/plugin-sdk/testing/app` harness tests first, then check in the host what a jsdom render cannot show:

| Area        | Check                                                                                                          | Verify with                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Integration | One title/header, correct navigation and panel behavior, correct thread/project/host target                    | Harness for registrations, navigation calls, and targets; live for the host chrome  |
| Themes      | Light, dark, and a non-default palette; legible text, selected states, and portal content                      | Live                                                                                |
| Layout      | Wide window, narrow split/panel, compact/coarse-pointer view; long names and larger text                       | Live                                                                                |
| Input       | Keyboard-only navigation, focus return, Escape, touch access to secondary actions                              | Harness for keyboard activation and dismissal; live for host focus order and touch  |
| State       | First load, empty, no matches, error/retry, offline/unavailable host, pending and failed writes                | Harness                                                                             |
| Lifecycle   | Close/reopen the panel, switch threads, reload the plugin, reconnect data; no duplicate effects or lost drafts | Harness for remount and reconnect; live for thread switching and reload in the host |

Live checks are for layout, host focus, portals, and client-specific behavior; they do not replace a harness test for a row the harness can verify. Follow [verification](verification.md#choose-the-test-boundary) for the boundary and for isolation. Record what was actually exercised; source inspection or a screenshot does not establish keyboard, touch, or lifecycle correctness.
