// Representative inputs, not an inventory of the current repository.
export const configuration = {
  workspaces: ["plugins/*"],
  scripts: {
    "format:check": "prettier . --check",
    lint: "oxlint plugins scripts --ignore-pattern 'plugins/excluded/**' --deny-warnings",
    check: "bun --filter '!bb-plugin-excluded' check",
    test: "bun --filter '!bb-plugin-excluded' test && bun test ./scripts/*.test.mjs",
    build: "bun --filter '!bb-plugin-excluded' build",
  },
};

export const oldPlugin = {
  name: "bb-plugin-old",
  version: "0.1.0",
  engines: { bb: ">=0.35", bbPluginSdk: "^0.4.1" },
  devDependencies: { "@get-bb/plugin-sdk": "0.4.87", "bb-app": "0.36.0" },
  scripts: {
    check: "tsc --noEmit",
    test: "node --test",
    build: "bb plugin build",
  },
};

export const runtimeDependency = {
  ...oldPlugin,
  name: "bb-plugin-runtime",
  dependencies: { "@get-bb/plugin-sdk": "0.6.132" },
  devDependencies: { "bb-app": "0.49.0" },
  engines: { bb: ">=0.49", bbPluginSdk: ">=0.6.132" },
};

export const excludedPlugin = {
  ...oldPlugin,
  name: "bb-plugin-excluded",
  devDependencies: { "bb-app": "0.36.0" },
};
