import type { ClaimInfo } from "@/lib/claimInfo";
import { buildJobInformationGroups } from "@/lib/jobInformation";

/**
 * Renders the inspection report's "Job Information" block as real HTML — three labeled groups,
 * each a small responsive grid of label/value pairs — instead of the flat 13-line plain-text list
 * the document-generation model used to produce. See `lib/jobInformation.ts`'s doc comment for why
 * this moved out of the model's output entirely; `lib/pdf.ts`'s `drawJobInformation` renders the
 * same grouped data for the PDF export, so the two never drift apart.
 */
export function JobInformationSection({ claim }: { claim: ClaimInfo }) {
  const groups = buildJobInformationGroups(claim);
  return (
    <div className="job-info">
      {groups.map((group) => (
        <div className="job-info-group" key={group.title}>
          <h3>{group.title}</h3>
          <div className="job-info-grid">
            {group.fields.map((field) => {
              const isEmpty = field.value === null || field.value === "";
              return (
                <div className="job-info-field" key={field.label}>
                  <div className="job-info-label">{field.label}</div>
                  <div className={`job-info-value${isEmpty ? " job-info-empty" : ""}`}>{isEmpty ? "—" : field.value}</div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
