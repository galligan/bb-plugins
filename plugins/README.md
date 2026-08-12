# Plugins

Each child directory is an independently versioned bb plugin package.

A plugin should contain its own `package.json` with a `bb` manifest, source,
tests, SDK declarations, and README. Keep dependencies local to the plugin so
it can be installed or published without the rest of this workspace.

Use the root workspace only to run repository-wide checks; it is not a shared
runtime package.
