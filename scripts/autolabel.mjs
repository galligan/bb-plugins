const categoryDescriptions = {
  docs: "Documentation changes",
  "agents/rules/": "Agent instructions and Claude rules",
  "agents/skills": "Agent and Claude skills",
};

export function labelsForFiles(files) {
  const labels = new Set();
  for (const file of files) {
    for (const name of [file.filename, file.previous_filename]) {
      const parts = (name ?? "").split("/");
      const [root, plugin, ...rest] = parts;
      if (root === "plugins" && plugin && rest.length)
        labels.add(`plugin/${plugin}`);
      const filename = parts.at(-1);
      const directories = parts.slice(0, -1);
      if (directories.includes("docs") || /\.(md|mdx)$/i.test(filename))
        labels.add("docs");
      if (filename === "AGENTS.md" || filename === "CLAUDE.md")
        labels.add("agents/rules/");
      for (let i = 0; i < directories.length - 1; i++) {
        if (directories[i] === ".claude" && directories[i + 1] === "rules")
          labels.add("agents/rules/");
        if (
          [".agents", ".claude"].includes(directories[i]) &&
          directories[i + 1] === "skills"
        )
          labels.add("agents/skills");
      }
    }
  }
  return [...labels].sort();
}

export async function autolabel({ github, context }) {
  const repo = context.repo;
  const pr = context.payload.pull_request;
  const { data: directories } = await github.rest.repos.getContent({
    ...repo,
    path: "plugins",
    ref: pr?.base.sha ?? context.sha,
  });
  const required = new Set(
    directories
      .filter((entry) => entry.type === "dir")
      .map((entry) => `plugin/${entry.name}`),
  );
  let labels = [];
  if (pr) {
    const files = await github.paginate(github.rest.pulls.listFiles, {
      ...repo,
      pull_number: pr.number,
      per_page: 100,
    });
    // GitHub caps this endpoint at 3,000 files; do not silently label a partial diff.
    if (files.length >= 3000)
      throw new Error(
        "PR reaches GitHub's 3,000-file limit; label it manually",
      );
    labels = labelsForFiles(files);
    for (const label of labels) required.add(label);
  }
  const existing = new Set(
    (
      await github.paginate(github.rest.issues.listLabelsForRepo, {
        ...repo,
        per_page: 100,
      })
    ).map((label) => label.name.toLowerCase()),
  );
  for (const name of required) {
    if (existing.has(name.toLowerCase())) continue;
    try {
      await github.rest.issues.createLabel({
        ...repo,
        name,
        color: "1d76db",
        description:
          categoryDescriptions[name] ??
          `Changes to ${name.replace("plugin/", "plugins/")}`,
      });
    } catch (error) {
      // Another PR can create the same label between listing and creation.
      if (
        error.status !== 422 ||
        !error.response?.data?.errors?.some(
          (entry) =>
            entry.resource === "Label" && entry.code === "already_exists",
        )
      )
        throw error;
    }
    existing.add(name.toLowerCase());
  }
  if (labels.length) {
    await github.rest.issues.addLabels({
      ...repo,
      issue_number: pr.number,
      labels,
    });
  }
}
