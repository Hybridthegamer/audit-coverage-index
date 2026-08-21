/**
 * Seed script — 5 real protocols across 3 chains (Ethereum · Arbitrum · Base).
 *
 * Run with:  npm run db:seed   (tsx db/seed.ts)
 *
 * Builds its own Neon HTTP connection rather than importing db/client.ts,
 * because that module is `server-only` and would throw under plain Node/tsx.
 *
 * Audit dates, commits and TVL figures here are ILLUSTRATIVE seed values for a
 * dev branch — realistic in shape, not asserted as current fact. The whole
 * point of the real ingest (build step 5) is to replace these with sourced data.
 *
 * The five deployments are wired to demonstrate every coverage_state:
 *   Aave (ETH)        -> current
 *   Uniswap (ETH)     -> drifted     (upgrade after covering audit)
 *   Compound (ETH)    -> drifted
 *   GMX (ARB)         -> unknown     (deployed commit not recorded)
 *   Aerodrome (BASE)  -> uncovered   (no audit covers deployed code)
 */

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";

import * as schema from "./schema";
import { computeDrift, type CandidateAudit } from "../lib/drift";

config({ path: ".env.local" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set (expected in .env.local)");
}

const db = drizzle(neon(databaseUrl), { schema });

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function main() {
  console.log("Seeding audit-coverage-index dev branch…");

  // Idempotent: wipe in one shot. CASCADE + RESTART IDENTITY so re-runs are
  // clean and ids start from 1 again.
  await db.execute(sql`
    TRUNCATE TABLE
      disclosure_events, findings, queue_items, outreach_events, leads,
      upgrade_events, audit_deployments, audits, deployments, protocols
    RESTART IDENTITY CASCADE;
  `);

  /* -------------------------------------------------- protocols ---------- */
  const [aave, uniswap, compound, gmx, aerodrome] = await db
    .insert(schema.protocols)
    .values([
      {
        name: "Aave",
        slug: "aave",
        website: "https://aave.com",
        defillamaId: "aave",
        githubRepo: "https://github.com/aave-dao/aave-v3-origin",
        twitter: "aave",
        securityContact: "security@aave.com",
        hasBounty: true,
        bountyPlatform: "immunefi",
        bountyUrl: "https://immunefi.com/bounty/aave/",
        isPublished: true,
      },
      {
        name: "Uniswap",
        slug: "uniswap",
        website: "https://uniswap.org",
        defillamaId: "uniswap",
        githubRepo: "https://github.com/Uniswap/v3-core",
        twitter: "Uniswap",
        securityContact: "security@uniswap.org",
        hasBounty: true,
        bountyPlatform: "cantina",
        bountyUrl: "https://cantina.xyz/bounties",
        isPublished: true,
      },
      {
        name: "Compound",
        slug: "compound",
        website: "https://compound.finance",
        defillamaId: "compound-finance",
        githubRepo: "https://github.com/compound-finance/comet",
        twitter: "compoundfinance",
        securityContact: "security@compound.finance",
        hasBounty: true,
        bountyPlatform: "immunefi",
        bountyUrl: "https://immunefi.com/bounty/compound/",
        isPublished: true,
      },
      {
        name: "GMX",
        slug: "gmx",
        website: "https://gmx.io",
        defillamaId: "gmx",
        githubRepo: "https://github.com/gmx-io/gmx-synthetics",
        twitter: "GMX_IO",
        securityContact: "security@gmx.io",
        hasBounty: true,
        bountyPlatform: "immunefi",
        bountyUrl: "https://immunefi.com/bounty/gmx/",
        isPublished: true,
      },
      {
        name: "Aerodrome",
        slug: "aerodrome",
        website: "https://aerodrome.finance",
        defillamaId: "aerodrome-v1",
        githubRepo: "https://github.com/aerodrome-finance/contracts",
        twitter: "aerodromefi",
        securityContact: null,
        hasBounty: false,
        bountyPlatform: "none",
        isPublished: true,
      },
    ])
    .returning({ id: schema.protocols.id });

  /* -------------------------------------------------- deployments -------- */
  const [
    aaveEth,
    uniEth,
    compEth,
    gmxArb,
    aeroBase,
  ] = await db
    .insert(schema.deployments)
    .values([
      {
        protocolId: aave!.id,
        chain: "ethereum",
        addressOrProgramId: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
        label: "Aave V3 Pool",
        tvlUsd: "6250000000.00",
        isUpgradeable: true,
        upgradeAuthority: "Aave Governance",
        deployedAt: d("2023-01-27"),
        lastUpgradedAt: d("2024-02-10"),
        deployedCommit: "e0bfed13", // covered by the covering audit below
        sourceVerified: true,
        explorerUrl:
          "https://etherscan.io/address/0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
      },
      {
        protocolId: uniswap!.id,
        chain: "ethereum",
        addressOrProgramId: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        label: "Uniswap V3 Factory",
        tvlUsd: "3100000000.00",
        isUpgradeable: false,
        deployedAt: d("2021-05-04"),
        lastUpgradedAt: d("2024-05-01"), // upgrade AFTER the covering audit -> drifted
        deployedCommit: "d8b1c635",
        sourceVerified: true,
        explorerUrl:
          "https://etherscan.io/address/0x1F98431c8aD98523631AE4a59f267346ea31F984",
      },
      {
        protocolId: compound!.id,
        chain: "ethereum",
        addressOrProgramId: "0xc3d688B66703497DAA19211EEdff47f25384cdc3",
        label: "Compound III (Comet) USDC",
        tvlUsd: "820000000.00",
        isUpgradeable: true,
        upgradeAuthority: "Compound Governance",
        deployedAt: d("2022-08-26"),
        lastUpgradedAt: d("2024-09-15"), // after covering audit -> drifted
        deployedCommit: "a71b4f90",
        sourceVerified: true,
        explorerUrl:
          "https://etherscan.io/address/0xc3d688B66703497DAA19211EEdff47f25384cdc3",
      },
      {
        protocolId: gmx!.id,
        chain: "arbitrum",
        addressOrProgramId: "0x489ee077994B6658eAfA855C308275EAd8097C4A",
        label: "GMX V2 Vault",
        tvlUsd: "540000000.00",
        isUpgradeable: false,
        deployedAt: d("2023-07-01"),
        lastUpgradedAt: d("2024-08-01"),
        deployedCommit: null, // commit not recorded -> unknown
        sourceVerified: false,
        explorerUrl:
          "https://arbiscan.io/address/0x489ee077994B6658eAfA855C308275EAd8097C4A",
      },
      {
        protocolId: aerodrome!.id,
        chain: "base",
        addressOrProgramId: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
        label: "Aerodrome Router",
        tvlUsd: "480000000.00",
        isUpgradeable: false,
        deployedAt: d("2023-08-28"),
        lastUpgradedAt: null,
        deployedCommit: "77c1d2aa", // known commit, but no audit covers it -> uncovered
        sourceVerified: true,
        explorerUrl:
          "https://basescan.org/address/0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
      },
    ])
    .returning({ id: schema.deployments.id });

  /* -------------------------------------------------- audits ------------- */
  // reviewedCommit values are chosen so each audit is an ancestor of the
  // deployment it's linked to (the git ancestry a real ingest would prove).
  const [aaveAudit, uniAudit, compAudit1, compAudit2, gmxAudit] = await db
    .insert(schema.audits)
    .values([
      {
        protocolId: aave!.id,
        auditor: "SigmaPrime",
        reportUrl: "https://github.com/aave-dao/aave-v3-origin/tree/main/audits",
        reportDate: d("2024-06-01"), // AFTER Aave's last upgrade -> current
        reviewedCommit: "e0bfed13",
        scopeNote: "Aave V3.1 Pool, L2Pool, libraries",
        source: "github",
        verifiedByMe: true,
      },
      {
        protocolId: uniswap!.id,
        auditor: "Trail of Bits",
        reportUrl: "https://github.com/Uniswap/v3-core/tree/main/audits",
        reportDate: d("2021-03-01"), // long BEFORE the 2024 upgrade -> drifted
        reviewedCommit: "d8b1c635",
        scopeNote: "Uniswap V3 core contracts",
        source: "auditor_site",
        verifiedByMe: true,
      },
      {
        protocolId: compound!.id,
        auditor: "OpenZeppelin",
        reportUrl: "https://github.com/compound-finance/comet/tree/main/audits",
        reportDate: d("2022-07-01"),
        reviewedCommit: "a71b4f90",
        scopeNote: "Comet core",
        source: "github",
        verifiedByMe: true,
      },
      {
        // A second Compound audit from a different firm, overlapping scope —
        // the many-to-many the join table exists for.
        protocolId: compound!.id,
        auditor: "ChainSecurity",
        reportUrl: "https://chainsecurity.com/security-audit/compound-iii",
        reportDate: d("2023-01-15"), // newer -> becomes the covering audit
        reviewedCommit: "a71b4f90",
        scopeNote: "Comet USDC market, rewards",
        source: "auditor_site",
        verifiedByMe: true,
      },
      {
        protocolId: gmx!.id,
        auditor: "Guardian Audits",
        reportUrl: "https://github.com/gmx-io/gmx-synthetics/tree/main/audits",
        reportDate: d("2023-06-01"),
        reviewedCommit: "f00dcafe", // ancestry unknowable: deployment has no commit
        scopeNote: "GMX V2 synthetics",
        source: "github",
        verifiedByMe: false,
      },
    ])
    .returning({ id: schema.audits.id });

  /* -------------------------------------------------- audit_deployments -- */
  // Aerodrome intentionally has NO audit linkage -> uncovered.
  await db.insert(schema.auditDeployments).values([
    { auditId: aaveAudit!.id, deploymentId: aaveEth!.id },
    { auditId: uniAudit!.id, deploymentId: uniEth!.id },
    { auditId: compAudit1!.id, deploymentId: compEth!.id },
    { auditId: compAudit2!.id, deploymentId: compEth!.id },
    { auditId: gmxAudit!.id, deploymentId: gmxArb!.id },
  ]);

  /* -------------------------------------------------- upgrade_events ----- */
  await db.insert(schema.upgradeEvents).values([
    {
      deploymentId: uniEth!.id,
      occurredAt: d("2024-05-01"),
      txHash: "0xseeduni0001",
      newImplementation: "0x000000000004444c5dc75cB358380D2e3dE08A90",
      blockNumber: 19780000,
    },
    {
      deploymentId: compEth!.id,
      occurredAt: d("2024-09-15"),
      txHash: "0xseedcomp0001",
      newImplementation: "0xB0b0000000000000000000000000000000000001",
      blockNumber: 20740000,
    },
    {
      deploymentId: aaveEth!.id,
      occurredAt: d("2024-02-10"),
      txHash: "0xseedaave0001",
      newImplementation: "0xA0a0000000000000000000000000000000000001",
      blockNumber: 19200000,
    },
  ]);

  /* -------------------------------------------------- drift recompute ---- */
  // Compute and store drift for every deployment via the single source of
  // truth. Ancestry is trivially true here because we linked each audit to a
  // deployment whose deployedCommit it reviewed; a real ingest proves this
  // with git merge-base.
  const now = new Date();
  const deploymentAudits: { deploymentId: number; audits: CandidateAudit[] }[] = [
    {
      deploymentId: aaveEth!.id,
      audits: [{ reviewedCommit: "e0bfed13", reportDate: d("2024-06-01"), isAncestorOfDeployed: true }],
    },
    {
      deploymentId: uniEth!.id,
      audits: [{ reviewedCommit: "d8b1c635", reportDate: d("2021-03-01"), isAncestorOfDeployed: true }],
    },
    {
      deploymentId: compEth!.id,
      audits: [
        { reviewedCommit: "a71b4f90", reportDate: d("2022-07-01"), isAncestorOfDeployed: true },
        { reviewedCommit: "a71b4f90", reportDate: d("2023-01-15"), isAncestorOfDeployed: true },
      ],
    },
    {
      deploymentId: gmxArb!.id,
      audits: [{ reviewedCommit: "f00dcafe", reportDate: d("2023-06-01"), isAncestorOfDeployed: false }],
    },
    { deploymentId: aeroBase!.id, audits: [] },
  ];

  const deployedById: Record<number, { deployedCommit: string | null; lastUpgradedAt: Date | null; deployedAt: Date | null }> = {
    [aaveEth!.id]: { deployedCommit: "e0bfed13", lastUpgradedAt: d("2024-02-10"), deployedAt: d("2023-01-27") },
    [uniEth!.id]: { deployedCommit: "d8b1c635", lastUpgradedAt: d("2024-05-01"), deployedAt: d("2021-05-04") },
    [compEth!.id]: { deployedCommit: "a71b4f90", lastUpgradedAt: d("2024-09-15"), deployedAt: d("2022-08-26") },
    [gmxArb!.id]: { deployedCommit: null, lastUpgradedAt: d("2024-08-01"), deployedAt: d("2023-07-01") },
    [aeroBase!.id]: { deployedCommit: "77c1d2aa", lastUpgradedAt: null, deployedAt: d("2023-08-28") },
  };

  for (const { deploymentId, audits: candidateAudits } of deploymentAudits) {
    const dep = deployedById[deploymentId]!;
    const result = computeDrift({
      deployedCommit: dep.deployedCommit,
      lastUpgradedAt: dep.lastUpgradedAt,
      deployedAt: dep.deployedAt,
      candidateAudits,
      now,
    });
    await db
      .update(schema.deployments)
      .set({
        coverageState: result.coverageState,
        driftDays: result.driftDays,
        lastCheckedAt: now,
      })
      .where(sql`${schema.deployments.id} = ${deploymentId}`);
  }

  /* -------------------------------------------------- private sample ----- */
  // A single lead + queue item so the private tables aren't empty in dev.
  const [lead] = await db
    .insert(schema.leads)
    .values({
      protocolId: aerodrome!.id,
      source: "outbound",
      contactHandle: "@aerodromefi",
      status: "new",
      notes: "No bounty, real TVL on Base, no audit covering current router. Tier B outreach.",
    })
    .returning({ id: schema.leads.id });

  await db.insert(schema.outreachEvents).values({
    leadId: lead!.id,
    eventType: "note",
    channel: "internal",
    note: "Sourced from seed. Confirm security.txt before any contact.",
  });

  await db.insert(schema.queueItems).values({
    deploymentId: uniEth!.id,
    status: "candidate",
    priority: 1,
    researchLog: "# Uniswap V3 factory\n\nCovering audit is 2021; on-chain change in 2024. Diff pending.",
  });

  console.log("Seed complete: 5 protocols, 5 deployments, 5 audits, 3 upgrade events.");
  const rows = await db
    .select({
      slug: schema.protocols.slug,
      chain: schema.deployments.chain,
      state: schema.deployments.coverageState,
      driftDays: schema.deployments.driftDays,
    })
    .from(schema.deployments)
    .innerJoin(schema.protocols, sql`${schema.protocols.id} = ${schema.deployments.protocolId}`)
    .orderBy(schema.protocols.slug);
  console.table(rows);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
