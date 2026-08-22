/**
 * GitHub audit-report discovery (build step 7).
 *
 * The third external source, and the one that upgrades step 6's coarse markers
 * into something computeDrift can actually use.
 *
 * What step 6 left behind: DefiLlama gives an audit COUNT and sometimes a bag
 * of report URLs, with no auditor, no report date and no reviewed commit — so
 * every sourced audit row is `auditor: "Unknown (DefiLlama)"` with two NULLs
 * where the drift engine needs values. What this module adds: protocols keep
 * their reports in the repo, in an `audits/` folder, in files named things like
 * `2023-05-12_Trail-of-Bits_Vault.pdf`. The auditor and the date are sitting in
 * the filename, and the git history says exactly when each file landed.
 *
 * Same shape rules as the other two source modules: network only, no DB client,
 * no drizzle schema, every parse a pure exported function tested against
 * fixtures.
 *
 * ── The line this module will not cross ────────────────────────────────────
 *
 * It does NOT write `audits.reviewed_commit`, and it does not create
 * `audit_deployments` links.
 *
 * The tempting heuristic is right there: the commit that ADDED the report file
 * is roughly the repo state the auditor reviewed, and it is one API call away.
 * But "roughly" is doing enormous work — reports land days or weeks after the
 * review ends, often on a branch, sometimes in a batch of five. Writing that
 * sha into `reviewed_commit` would feed a guess to computeDrift, which would
 * publish it as `current` or `drifted`: a specific, checkable, public claim
 * about whether someone's deployed money was reviewed, resting on a filename
 * and a commit date.
 *
 * So the sha is recorded as a CANDIDATE in `scope_note`, where it is visibly a
 * note, and the researcher promotes it in the workspace with an explicit action
 * that also sets `verified_by_me`. Same rule as `deployed_commit` in
 * lib/sources/explorer.ts, and the same rule step 6 followed when it let ~900
 * protocols sit honestly at `unknown`.
 *
 * `report_date` follows the same logic one notch weaker: written when the
 * filename or path STATES a date (that is the protocol's own claim about its
 * report, not our inference), left NULL otherwise, with the commit date offered
 * as a candidate in the note.
 */

export const GITHUB_API_BASE = "https://api.github.com";

export const GITHUB_USER_AGENT =
  "audit-coverage-index/0.1 (+https://github.com/audit-coverage-index)";

/* ------------------------------------------------------------------ *
 * Repo references
 * ------------------------------------------------------------------ */

export interface RepoRef {
  owner: string;
  repo: string;
}

/**
 * `protocols.github_repo` is whatever we last recorded, and after step 6 that
 * is usually an ORG page (`https://github.com/lidofinance`) because the
 * DefiLlama feed only knows the org. Both shapes have to parse.
 *
 * Returns `{ owner, repo: null }` for an org page — the caller then has to pick
 * a repo, which is `rankCandidateRepos` below.
 */
export function parseGithubUrl(
  value: string | null,
): { owner: string; repo: string | null } | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  let path: string;
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (!/(^|\.)github\.com$/i.test(url.hostname)) return null;
    path = url.pathname;
  } catch {
    return null;
  }

  const segments = path.split("/").filter((s) => s.length > 0);
  const owner = segments[0];
  if (owner === undefined || !/^[A-Za-z0-9_.-]+$/.test(owner)) return null;

  const repo = segments[1];
  if (repo === undefined) return { owner, repo: null };
  // Strip a trailing `.git` and ignore deep links (/tree/main, /blob/…).
  const cleaned = repo.replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9_.-]+$/.test(cleaned)) return { owner, repo: null };
  return { owner, repo: cleaned };
}

/** One repo from the org listing, reduced to what ranking needs. */
export interface CandidateRepo {
  name: string;
  fork: boolean;
  archived: boolean;
  stars: number;
  pushedAt: Date | null;
  description: string | null;
}

/**
 * Which repo in an org holds the contracts and the audits.
 *
 * A DeFi org has thirty repos — a frontend, a subgraph, an SDK, docs, three
 * forks — and exactly one or two with the Solidity in them. Guessing wrong
 * costs a wasted tree walk, so the heuristic leans on the names these repos
 * reliably have (`*-contracts`, `core`, `protocol`, `*-v2`) and hard-drops
 * forks and archives, which are never the live deployment.
 *
 * Pure and exported so the ranking can be argued with in a test rather than
 * discovered in production.
 */
const REPO_NAME_HINTS: [RegExp, number][] = [
  // A repo literally called `audits` outranks everything: several protocols
  // (Lido among them) keep every report in a dedicated repo rather than in a
  // folder of the contracts repo, and that repo is unambiguously the answer.
  [/^audits?$/i, 70],
  [/(^|[-_])contracts?([-_]|$)/i, 50],
  [/(^|[-_])core([-_]|$)/i, 30],
  [/(^|[-_])protocol([-_]|$)/i, 30],
  [/audit/i, 25],
  [/(^|[-_])v\d([-_]|$)/i, 15],
  [/solidity|evm|onchain|on-chain/i, 15],
];

const REPO_NAME_PENALTIES: [RegExp, number][] = [
  [/interface|frontend|front-end|ui|website|www|app$/i, 40],
  [/docs?|documentation|brand|assets|media/i, 35],
  [/sdk|subgraph|api|bot|scripts?|tooling|cli/i, 25],
];

export function rankCandidateRepos(repos: readonly CandidateRepo[]): CandidateRepo[] {
  const scored = repos
    .filter((r) => !r.fork && !r.archived)
    .map((r) => {
      let score = 0;
      for (const [pattern, points] of REPO_NAME_HINTS) {
        if (pattern.test(r.name)) score += points;
      }
      for (const [pattern, points] of REPO_NAME_PENALTIES) {
        if (pattern.test(r.name)) score -= points;
      }
      if (r.description !== null && /audit/i.test(r.description)) score += 10;
      // Stars, log-compressed: popularity is a hint, never the deciding vote.
      score += Math.min(20, Math.log10(Math.max(1, r.stars)) * 6);
      return { repo: r, score };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.repo.pushedAt?.getTime() ?? 0) - (a.repo.pushedAt?.getTime() ?? 0),
    );

  return scored.map((s) => s.repo);
}

/* ------------------------------------------------------------------ *
 * Audit folders
 * ------------------------------------------------------------------ */

/**
 * Where protocols actually keep reports, in the order worth trying. The list is
 * short on purpose: each miss is an API call, and unauthenticated GitHub allows
 * sixty an hour.
 */
export const AUDIT_FOLDER_CANDIDATES: readonly string[] = [
  "audits",
  "audit",
  "docs/audits",
  "security/audits",
  "doc/audits",
  "reports/audits",
];

/** Report file extensions. A .md summary counts; a .sol does not. */
const REPORT_EXTENSIONS = /\.(pdf|md|markdown|txt|html)$/i;

export function looksLikeReportFile(name: string): boolean {
  if (!REPORT_EXTENSIONS.test(name)) return false;
  // README.md in an audits folder is an index, not a report.
  return !/^readme\.(md|markdown|txt)$/i.test(name.trim());
}

/* ------------------------------------------------------------------ *
 * Auditor + date parsing (pure)
 * ------------------------------------------------------------------ */

/**
 * The firms whose names actually appear in these filenames. Matching against a
 * list rather than "the token before the first dash" is the difference between
 * `auditor: "Trail of Bits"` and `auditor: "2023"`.
 *
 * Each entry is [canonical name, pattern]. Patterns are matched against the
 * filename with separators normalised, so `trail-of-bits`, `TrailOfBits` and
 * `trail_of_bits` all land on one canonical string — which matters, because
 * the auditor column is what a researcher groups by.
 */
const KNOWN_AUDITORS: [string, RegExp][] = [
  ["Trail of Bits", /trail[\s_-]*of[\s_-]*bits|\btob\b/i],
  ["OpenZeppelin", /open[\s_-]*zeppelin|\boz\b/i],
  ["ConsenSys Diligence", /consensys|diligence/i],
  ["Spearbit", /spearbit/i],
  ["Cantina", /cantina/i],
  ["Sherlock", /sherlock/i],
  ["Code4rena", /code4rena|c4\b/i],
  ["Zellic", /zellic/i],
  ["Certora", /certora/i],
  ["ChainSecurity", /chain[\s_-]*security/i],
  ["Halborn", /halborn/i],
  ["Quantstamp", /quantstamp/i],
  ["PeckShield", /peck[\s_-]*shield/i],
  ["SlowMist", /slow[\s_-]*mist/i],
  ["Hacken", /hacken/i],
  ["Sigma Prime", /sigma[\s_-]*prime/i],
  ["MixBytes", /mix[\s_-]*bytes/i],
  ["OtterSec", /otter[\s_-]*sec/i],
  ["Neodyme", /neodyme/i],
  ["Runtime Verification", /runtime[\s_-]*verification|\brv\b/i],
  ["Dedaub", /dedaub/i],
  ["Macro", /(^|[\s_.\-\/])macro([\s_.\-]|$)/i],
  ["Nethermind", /nethermind/i],
  ["Zokyo", /zokyo/i],
  ["CertiK", /certik/i],
  ["Kudelski", /kudelski/i],
  ["Least Authority", /least[\s_-]*authority/i],
  ["Ackee Blockchain", /ackee/i],
  ["Guardian", /guardian[\s_-]*audits/i],
  ["Pashov", /pashov/i],
  ["Blocksec", /block[\s_-]*sec/i],
  ["Veridise", /veridise/i],
  ["Statemind", /statemind/i],
  ["Oak Security", /oak[\s_-]*security/i],
  ["Informal Systems", /informal[\s_-]*systems/i],
  // Added after a live discovery run over Aave and Lido turned them up. The
  // list is a maintenance surface by design: an unknown firm becomes
  // "Unknown (GitHub)" rather than a wrong attribution, so a gap degrades
  // instead of lying, and adding a row here is the whole fix.
  // NOT /\babdk\b/ — underscore is a word character, so `_ABDK_` has no word
  // boundary and the obvious regex silently never matches. Every pattern here
  // uses the explicit separator class for that reason.
  ["ABDK", /(^|[\s_.\-\/])abdk([\s_.\-]|$)/i],
  ["Cyfrin", /cyfrin/i],
  ["Omniscia", /omniscia/i],
  ["Beosin", /beosin/i],
  ["Salus", /(^|[\s_.\-\/])salus([\s_.\-]|$)/i],
  ["Coinspect", /coinspect/i],
  ["Sec3", /(^|[\s_.\-\/])sec3([\s_.\-]|$)/i],
  ["Paladin", /paladin[\s_-]*blockchain|paladin[\s_-]*sec/i],
  ["Three Sigma", /three[\s_-]*sigma/i],
  ["Bailsec", /bail[\s_-]*sec/i],
];

/**
 * The auditor named in a filename or path, or null.
 *
 * Null is a real answer and is written through as null — `audits.auditor` is
 * NOT NULL, so the write half substitutes an explicit "Unknown (GitHub)" rather
 * than letting a bad guess pass as a firm's name and attach a stranger's
 * reputation to a report they may not have written.
 */
export function parseAuditor(path: string): string | null {
  for (const [name, pattern] of KNOWN_AUDITORS) {
    if (pattern.test(path)) return name;
  }
  return null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** A UTC date, or null when the parts do not describe a real one. */
function utcDate(year: number, month: number, day: number): Date | null {
  if (year < 2014 || year > 2100) return null; // pre-Ethereum is a false match
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

/**
 * The date STATED in a report's filename or path, or null.
 *
 * Only the protocol's own claim counts. When a filename says nothing, this
 * returns null and the caller leaves `audits.report_date` NULL — which drives
 * `unknown` rather than a guess, exactly as lib/drift.ts documents. The commit
 * date is offered separately, as a candidate in the scope note.
 *
 * A day-less date (`2023-05`, `May-2023`) resolves to the FIRST of the month:
 * report_date is compared against `last_upgraded_at`, so the earlier reading is
 * the conservative one — it can only make coverage look more drifted, never
 * less, and this project never rounds in its own favour.
 */
export function parseReportDate(path: string): Date | null {
  const text = path.replace(/\\/g, "/");

  // 2023-05-12 / 2023_05_12 / 20230512
  const ymd = text.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?!\d)/);
  if (ymd) {
    const parsed = utcDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
    if (parsed) return parsed;
  }

  // 12-05-2023 — day first, the European convention these files often use.
  const dmy = text.match(/(?<!\d)(\d{2})[-_.](\d{2})[-_.](20\d{2})(?!\d)/);
  if (dmy) {
    const parsed = utcDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
    if (parsed) return parsed;
  }

  // May-2023 / 2023-May / jan2024
  const named = text.match(
    /(?:(20\d{2})[-_. ]*([a-z]{3,9})|([a-z]{3,9})[-_. ]*(20\d{2}))(?![a-z])/i,
  );
  if (named) {
    const year = Number(named[1] ?? named[4]);
    const monthWord = (named[2] ?? named[3] ?? "").slice(0, 3).toLowerCase();
    const month = MONTHS[monthWord];
    if (month !== undefined) {
      const parsed = utcDate(year, month, 1);
      if (parsed) return parsed;
    }
  }

  // 2023-05 / 2023_05, no day.
  const ym = text.match(/(20\d{2})[-_.](\d{2})(?![\d-])/);
  if (ym) {
    const parsed = utcDate(Number(ym[1]), Number(ym[2]), 1);
    if (parsed) return parsed;
  }

  // 07-2026 — month first, four-digit year. Very common ("… Report 07-2026.pdf")
  // and unambiguous: the four-digit group can only be the year. Checked AFTER
  // the day-first rule above, so `12-05-2023` is never mis-read as a month.
  const my = text.match(/(?<!\d)(\d{2})[-_.](20\d{2})(?!\d)/);
  if (my) {
    const parsed = utcDate(Number(my[2]), Number(my[1]), 1);
    if (parsed) return parsed;
  }

  // Deliberately NOT parsed: two-digit years (`10-24`). "October 2024" and
  // "the 10th of 2024-something" are both readings, and report_date feeds
  // computeDrift. A null here is the honest answer and the scope note carries
  // the commit date as a candidate instead.

  // A bare year is too coarse to compare against an upgrade timestamp.
  return null;
}

/* ------------------------------------------------------------------ *
 * Discovered record
 * ------------------------------------------------------------------ */

/** One audit report found in a repo. */
export interface DiscoveredReport {
  /** Auditor parsed from the filename, or null when nothing matched. */
  auditor: string | null;
  /** Permanent blob URL — what goes into `audits.report_url`. */
  reportUrl: string;
  /** Path inside the repo, kept for the scope note. */
  path: string;
  /** Date STATED in the filename. Null means null in the DB. */
  reportDate: Date | null;
  /** The commit that added the file. A CANDIDATE reviewed commit, never written. */
  candidateCommit: string | null;
  /** When that commit landed. A CANDIDATE report date, never written. */
  candidateCommitDate: Date | null;
}

export interface DiscoveryResult {
  repo: RepoRef | null;
  /** The folder the reports came from, for the note. */
  folder: string | null;
  reports: DiscoveredReport[];
  warnings: string[];
}

/* ------------------------------------------------------------------ *
 * Network
 * ------------------------------------------------------------------ */

export interface GithubOptions {
  /** A token lifts the rate limit from 60/hr to 5,000/hr. Optional. */
  token: string | null;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Resolve the commit that added each report. One extra call per file. */
  resolveCommits?: boolean;
  /** Cap on reports per repo, so one archive folder cannot dominate a run. */
  maxReports?: number;
}

const DEFAULT_MAX_REPORTS = 40;

type GithubOutcome =
  | { kind: "ok"; body: unknown }
  | { kind: "missing" }
  | { kind: "error"; message: string };

async function githubGet(path: string, options: GithubOptions): Promise<GithubOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": GITHUB_USER_AGENT,
    "x-github-api-version": "2022-11-28",
  };
  if (options.token !== null) headers.authorization = `Bearer ${options.token}`;

  const response = await fetchImpl(`${GITHUB_API_BASE}${path}`, {
    headers,
    signal: options.signal,
    cache: "no-store",
  });

  // 404 is the normal answer for "this repo has no audits folder" and must not
  // read as a failure — it is the single most common outcome of a discovery run.
  if (response.status === 404) return { kind: "missing" };

  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    return {
      kind: "error",
      message:
        remaining === "0"
          ? "GitHub rate limit exhausted — set GITHUB_TOKEN to raise it to 5,000/hr"
          : `GitHub refused the request (${response.status})`,
    };
  }

  if (!response.ok) {
    return { kind: "error", message: `GitHub responded ${response.status}` };
  }

  return { kind: "ok", body: (await response.json()) as unknown };
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Rank an org's repos, most likely to hold the contracts first. */
export async function listOrgRepos(
  owner: string,
  options: GithubOptions,
): Promise<CandidateRepo[]> {
  // Orgs and user accounts are different endpoints and a protocol can be either.
  for (const path of [
    `/orgs/${owner}/repos?per_page=100&sort=pushed`,
    `/users/${owner}/repos?per_page=100&sort=pushed`,
  ]) {
    const outcome = await githubGet(path, options);
    if (outcome.kind !== "ok" || !Array.isArray(outcome.body)) continue;

    const repos: CandidateRepo[] = [];
    for (const entry of outcome.body) {
      if (entry === null || typeof entry !== "object") continue;
      const raw = entry as Record<string, unknown>;
      const name = asString(raw.name);
      if (name === null) continue;
      const pushed = asString(raw.pushed_at);
      const pushedAt = pushed === null ? null : new Date(pushed);
      repos.push({
        name,
        fork: raw.fork === true,
        archived: raw.archived === true,
        stars: typeof raw.stargazers_count === "number" ? raw.stargazers_count : 0,
        pushedAt: pushedAt !== null && !Number.isNaN(pushedAt.getTime()) ? pushedAt : null,
        description: asString(raw.description),
      });
    }
    if (repos.length > 0) return rankCandidateRepos(repos);
  }
  return [];
}

/** List one folder. Returns null when the folder does not exist. */
async function listFolder(
  repo: RepoRef,
  folder: string,
  options: GithubOptions,
): Promise<Record<string, unknown>[] | null> {
  // `folder` is "" for a repo root, which the contents endpoint spells as a
  // bare trailing slash.
  const outcome = await githubGet(
    `/repos/${repo.owner}/${repo.repo}/contents/${encodeURI(folder)}`,
    options,
  );
  if (outcome.kind !== "ok" || !Array.isArray(outcome.body)) return null;
  return outcome.body.filter(
    (e): e is Record<string, unknown> => e !== null && typeof e === "object",
  );
}

/** The commit that most recently touched a path — the candidate reviewed commit. */
async function lastCommitFor(
  repo: RepoRef,
  path: string,
  options: GithubOptions,
): Promise<{ sha: string | null; date: Date | null }> {
  const outcome = await githubGet(
    `/repos/${repo.owner}/${repo.repo}/commits?per_page=1&path=${encodeURIComponent(path)}`,
    options,
  );
  if (outcome.kind !== "ok" || !Array.isArray(outcome.body)) {
    return { sha: null, date: null };
  }
  const entry = outcome.body[0];
  if (entry === null || typeof entry !== "object") return { sha: null, date: null };

  const raw = entry as Record<string, unknown>;
  const commit = raw.commit as Record<string, unknown> | undefined;
  const author = commit?.author as Record<string, unknown> | undefined;
  const dateStr = asString(author?.date);
  const date = dateStr === null ? null : new Date(dateStr);

  return {
    sha: asString(raw.sha),
    date: date !== null && !Number.isNaN(date.getTime()) ? date : null,
  };
}

/**
 * Find a protocol's audit reports.
 *
 * `githubRepo` may be a repo URL or, after a step-6 sync, an org page — the org
 * case ranks the org's repos and walks the best one. Everything fails soft: a
 * protocol with no GitHub, no audits folder, or a rate-limited run returns an
 * empty result with a warning, never an exception, so one bad protocol cannot
 * abort a sweep of nine hundred.
 */
export async function discoverAuditReports(
  githubRepo: string | null,
  options: GithubOptions,
): Promise<DiscoveryResult> {
  const warnings: string[] = [];
  const parsed = parseGithubUrl(githubRepo);
  if (parsed === null) {
    return { repo: null, folder: null, reports: [], warnings: ["no GitHub URL on record"] };
  }

  let candidates: RepoRef[];
  if (parsed.repo !== null) {
    candidates = [{ owner: parsed.owner, repo: parsed.repo }];
  } else {
    const ranked = await listOrgRepos(parsed.owner, options);
    if (ranked.length === 0) {
      warnings.push(`no repos listed for ${parsed.owner}`);
    }
    // Only the top few: each miss costs a call against a 60/hr budget.
    candidates = ranked.slice(0, 3).map((r) => ({ owner: parsed.owner, repo: r.name }));
  }

  const maxReports = options.maxReports ?? DEFAULT_MAX_REPORTS;

  for (const repo of candidates) {
    // A repo named `audits` keeps its PDFs at the root; everything else keeps
    // them in a folder. Probing the root of a normal contracts repo would list
    // the whole tree for nothing, so the root is only tried where it pays.
    const folders = /^audits?$|security/i.test(repo.repo)
      ? ["", ...AUDIT_FOLDER_CANDIDATES]
      : AUDIT_FOLDER_CANDIDATES;

    for (const folder of folders) {
      const entries = await listFolder(repo, folder, options);
      if (entries === null) continue;

      const files = entries.filter((e) => {
        const name = asString(e.name);
        return e.type === "file" && name !== null && looksLikeReportFile(name);
      });
      if (files.length === 0) continue;

      const reports: DiscoveredReport[] = [];
      for (const file of files.slice(0, maxReports)) {
        const path = asString(file.path) ?? asString(file.name) ?? "";
        const reportUrl =
          asString(file.html_url) ??
          asString(file.download_url) ??
          `https://github.com/${repo.owner}/${repo.repo}/blob/HEAD/${path}`;

        let candidateCommit: string | null = null;
        let candidateCommitDate: Date | null = null;
        if (options.resolveCommits !== false) {
          const commit = await lastCommitFor(repo, path, options);
          candidateCommit = commit.sha;
          candidateCommitDate = commit.date;
        }

        reports.push({
          auditor: parseAuditor(path),
          reportUrl,
          path,
          reportDate: parseReportDate(path),
          candidateCommit,
          candidateCommitDate,
        });
      }

      const folderLabel = folder === "" ? repo.repo : folder;

      if (files.length > maxReports) {
        warnings.push(
          `${folderLabel} holds ${files.length} reports; imported the first ${maxReports}`,
        );
      }

      return { repo, folder: folderLabel, reports, warnings };
    }
  }

  warnings.push("no audits folder found");
  return { repo: candidates[0] ?? null, folder: null, reports: [], warnings };
}
