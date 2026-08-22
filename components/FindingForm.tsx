import { FINDING_STATUS_LABEL } from "@/lib/format";

/**
 * The findings editor form — shared by the "new finding" and "edit finding"
 * pages. A plain server-rendered form posting to whichever server action is
 * passed in; no client JS, so it degrades cleanly like the rest of the site.
 *
 * There is a field for `pocRef` (a string pointer) and deliberately none for
 * PoC code — runnable exploits never enter this database (hard constraint).
 */

const SEVERITY_OPTIONS = [
  "",
  "critical",
  "high",
  "medium",
  "low",
  "informational",
] as const;

export interface FindingFormValues {
  title: string;
  severity: string | null;
  immunefiClass: string | null;
  fundsAtRiskUsd: number | null;
  status: string;
  summary: string | null;
  rootCause: string | null;
  attackPath: string | null;
  preconditions: string | null;
  impact: string | null;
  recommendedFix: string | null;
  pocRef: string | null;
  inPostAuditCode: boolean;
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  required,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="bam-field">
      <label className="bam-label" htmlFor={name}>
        {label}
        {required ? " *" : ""}
      </label>
      <input
        id={name}
        name={name}
        className="bam-input"
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        required={required}
      />
    </div>
  );
}

function TextArea({
  label,
  name,
  defaultValue,
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  placeholder?: string;
}) {
  return (
    <div className="bam-field">
      <label className="bam-label" htmlFor={name}>
        {label}
      </label>
      <textarea
        id={name}
        name={name}
        className="bam-input"
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
      />
    </div>
  );
}

export function FindingForm({
  action,
  deploymentId,
  findingId,
  initial,
  submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  deploymentId?: number;
  findingId?: number;
  initial?: FindingFormValues;
  submitLabel: string;
}) {
  return (
    <form action={action}>
      {deploymentId !== undefined ? (
        <input type="hidden" name="deploymentId" value={deploymentId} />
      ) : null}
      {findingId !== undefined ? (
        <input type="hidden" name="findingId" value={findingId} />
      ) : null}

      <Field
        label="Title"
        name="title"
        defaultValue={initial?.title}
        placeholder="One-line description of the bug"
        required
      />

      <div className="bam-form-grid">
        <div className="bam-field">
          <label className="bam-label" htmlFor="severity">
            Severity
          </label>
          <select
            id="severity"
            name="severity"
            className="bam-input"
            defaultValue={initial?.severity ?? ""}
          >
            {SEVERITY_OPTIONS.map((s) => (
              <option key={s || "none"} value={s}>
                {s === "" ? "—" : s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="bam-field">
          <label className="bam-label" htmlFor="status">
            Status
          </label>
          <select
            id="status"
            name="status"
            className="bam-input"
            defaultValue={initial?.status ?? "draft"}
          >
            {Object.entries(FINDING_STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="bam-form-grid">
        <Field
          label="Immunefi class"
          name="immunefiClass"
          defaultValue={initial?.immunefiClass}
          placeholder="e.g. Smart Contract / Critical"
        />
        <Field
          label="Funds at risk (USD)"
          name="fundsAtRiskUsd"
          defaultValue={
            initial?.fundsAtRiskUsd !== null && initial?.fundsAtRiskUsd !== undefined
              ? String(initial.fundsAtRiskUsd)
              : ""
          }
          placeholder="e.g. 2500000"
        />
      </div>

      <TextArea
        label="Summary"
        name="summary"
        defaultValue={initial?.summary}
        placeholder="What the bug is, in a paragraph."
      />
      <TextArea label="Root cause" name="rootCause" defaultValue={initial?.rootCause} />
      <TextArea label="Attack path" name="attackPath" defaultValue={initial?.attackPath} />
      <TextArea
        label="Preconditions"
        name="preconditions"
        defaultValue={initial?.preconditions}
      />
      <TextArea label="Impact" name="impact" defaultValue={initial?.impact} />
      <TextArea
        label="Recommended fix"
        name="recommendedFix"
        defaultValue={initial?.recommendedFix}
      />

      <Field
        label="PoC reference (pointer only)"
        name="pocRef"
        defaultValue={initial?.pocRef}
        placeholder="repo URL, gist id, or local path — never code"
      />

      <div className="bam-field">
        <label
          className="bam-label"
          htmlFor="inPostAuditCode"
          style={{ display: "flex", alignItems: "center", gap: "0.6rem", cursor: "pointer" }}
        >
          <input
            id="inPostAuditCode"
            name="inPostAuditCode"
            type="checkbox"
            defaultChecked={initial?.inPostAuditCode ?? false}
          />
          Bug lives in post-audit (drifted / uncovered) code
        </label>
      </div>

      <button type="submit" className="bam-btn-primary">
        {submitLabel}
      </button>
    </form>
  );
}
