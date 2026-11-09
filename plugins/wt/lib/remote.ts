import { basename } from "node:path";

import { slug } from "./paths.ts";

interface KnownHost {
  /** Matches this domain and any subdomain of it. */
  readonly domain: string;
  readonly alias: string;
  /** A leading path segment the service adds that is not part of the repo. */
  readonly stripPrefix?: string;
}

// Short folder names for the forges in use. A host that is not listed here,
// such as a self-hosted Gitea, uses its full hostname instead.
const KNOWN_HOSTS: readonly KnownHost[] = [
  { domain: "github.com", alias: "gh" },
  { domain: "gitlab.com", alias: "gl" },
  // Entire remotes name a region: entire://aws-us-east-2.entire.io/et/<owner>/<repo>
  { domain: "entire.io", alias: "et", stripPrefix: "et" },
  // Cursor Origin: https://origin.cursor.com/<owner>/<repo>.git
  { domain: "origin.cursor.com", alias: "cursor", stripPrefix: "git" },
  { domain: "gitea.com", alias: "gitea" },
  { domain: "codeberg.org", alias: "codeberg" },
];

function parseRemote(url: string): { host: string; path: string } | null {
  // A local path or file URI names no host.
  if (url === "" || /^(?:[/.~]|file:)/iu.test(url)) return null;
  const full =
    /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.*)$/iu.exec(url);
  if (full !== null) return { host: full[1] ?? "", path: full[2] ?? "" };
  if (url.includes("://")) return null;
  // scp-like: [user@]host:path, where the path may be relative or absolute.
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/u.exec(url);
  return scp === null ? null : { host: scp[1] ?? "", path: scp[2] ?? "" };
}

/**
 * The folder segments a repository's worktrees live under, derived from its
 * `origin` remote so they survive a project rename or a moved checkout:
 * `[host alias, ...owner path, repo]`. Without a usable remote it is
 * `["_local", <checkout folder name>]`.
 */
export function repoLocation(
  remoteUrl: string | null,
  checkoutPath: string,
): string[] {
  const local = ["_local", slug(basename(checkoutPath))];
  const parsed = remoteUrl === null ? null : parseRemote(remoteUrl.trim());
  if (parsed === null) return local;

  const host = parsed.host.toLowerCase();
  const known = KNOWN_HOSTS.find(
    (entry) => host === entry.domain || host.endsWith(`.${entry.domain}`),
  );
  let segments = parsed.path
    .replace(/\.git\/?$/u, "")
    .split("/")
    .filter((segment) => segment !== "" && segment !== "." && segment !== "..");
  if (known?.stripPrefix !== undefined && segments[0] === known.stripPrefix) {
    segments = segments.slice(1);
  }
  if (segments.length === 0) return local;
  return [known?.alias ?? slug(host), ...segments.map(slug)];
}
