import type { Metadata } from "next";

/**
 * The workspace gate. A single password field posting to the `login` server
 * action; no client JS, so it works with scripts off (in keeping with the rest
 * of the site). On a wrong password the action redirects back here with
 * `?error=1`, which this page reads to show the notice — the password itself
 * never round-trips.
 *
 * force-dynamic because it reads searchParams and must never be cached: this is
 * the one /workspace page the middleware lets through unauthenticated.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;

  return (
    <main className="bam-page">
      <section
        className="bam-pad-x"
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div className="bam-narrow" style={{ width: "100%" }}>
          <p className="bam-eyebrow">AUDIT COVERAGE INDEX · PRIVATE</p>
          <h1 className="bam-headline" style={{ marginBottom: "var(--bam-space-lg)" }}>
            Workspace.
          </h1>
          <p
            className="bam-body"
            style={{ maxWidth: "42ch", marginBottom: "var(--bam-space-xl)" }}
          >
            The research side of the index — the queue, the targets, and the work
            that has not been published yet. One key holder.
          </p>

          {error ? (
            <div
              className="bam-notice"
              style={{ marginBottom: "var(--bam-space-lg)" }}
            >
              <p className="bam-notice-label">Rejected</p>
              <p className="bam-notice-body">
                That password did not match. Try again.
              </p>
            </div>
          ) : null}

          <form method="POST" action="/workspace/auth">
            {next ? <input type="hidden" name="next" value={next} /> : null}
            <div className="bam-field">
              <label className="bam-label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                autoFocus
                required
                className={`bam-input${error ? " bam-input--error" : ""}`}
                placeholder="Enter workspace password"
              />
            </div>
            <button type="submit" className="bam-btn-primary">
              Enter
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
