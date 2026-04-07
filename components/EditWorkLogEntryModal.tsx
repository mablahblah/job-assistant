"use client";

import { useState, useTransition } from "react";
import { XIcon } from "@phosphor-icons/react";
import { updateWorkSearchEntry } from "@/app/actions";
import type { WorkSearchEntryWithRelations } from "@/app/actions";

interface Props {
  entry: WorkSearchEntryWithRelations;
  onClose: () => void;
}

const ACTIVITY_TYPES = ["Applied for job", "Had phone screen", "Had interview"];

export default function EditWorkLogEntryModal({ entry, onClose }: Props) {
  const { job } = entry;
  const { company } = job;

  // Local form state pre-filled from entry data
  const [date, setDate] = useState(
    // Convert ISO to yyyy-MM-dd for <input type="date">
    new Date(entry.date).toISOString().split("T")[0]
  );
  const [activityType, setActivityType] = useState(entry.activityType);
  const [result, setResult] = useState(entry.result);
  const [jobTitle, setJobTitle] = useState(job.title);
  const [companyAddress, setCompanyAddress] = useState(company.address ?? "");
  const [companyPhone, setCompanyPhone] = useState(company.phone ?? "");
  const [companyWebsite, setCompanyWebsite] = useState(company.website ?? "");

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      try {
        await updateWorkSearchEntry(entry.id, {
          date: new Date(date).toISOString(),
          activityType,
          result,
          jobTitle,
          companyAddress,
          companyPhone,
          companyWebsite,
        });
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      {/* Stop click from bubbling to backdrop */}
      <div className="modal" style={{ maxWidth: "38rem" }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <h2 className="modal-title">Edit Work Search Entry</h2>
          <button
            className="btn btn-ghost"
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            <XIcon size={18} weight="bold" />
          </button>
        </div>

        {/* Form fields */}
        <div className="flex flex-col gap-4 px-2 pb-2">
          {/* Date */}
          <div className="work-log-field-group">
            <label className="work-log-field-label">Date of Activity</label>
            <input
              type="date"
              className="input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          {/* Activity type */}
          <div className="work-log-field-group">
            <label className="work-log-field-label">Activity Type</label>
            <select
              className="select"
              value={activityType}
              onChange={(e) => setActivityType(e.target.value)}
            >
              {ACTIVITY_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Job title */}
          <div className="work-log-field-group">
            <label className="work-log-field-label">Job Title</label>
            <input
              type="text"
              className="input"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
            />
          </div>

          {/* Company name — read-only (it's the DB unique key) */}
          <div className="work-log-field-group">
            <label className="work-log-field-label">Company Name</label>
            <p className="work-log-readonly-value">{company.name}</p>
            <p className="text-faint" style={{ fontSize: "0.75em", marginTop: "0.25rem" }}>
              To fix a company name, use the Companies page.
            </p>
          </div>

          {/* Company address */}
          <div className="work-log-field-group">
            <label className="work-log-field-label">Company Address</label>
            <input
              type="text"
              className="input"
              value={companyAddress}
              onChange={(e) => setCompanyAddress(e.target.value)}
              placeholder="e.g. 123 Main St, Austin, TX 78701"
            />
          </div>

          {/* Company phone */}
          <div className="work-log-field-group">
            <label className="work-log-field-label">Company Phone</label>
            <input
              type="text"
              className="input"
              value={companyPhone}
              onChange={(e) => setCompanyPhone(e.target.value)}
              placeholder="e.g. (512) 555-1234"
            />
          </div>

          {/* Company website */}
          <div className="work-log-field-group">
            <label className="work-log-field-label">Company Website</label>
            <input
              type="text"
              className="input"
              value={companyWebsite}
              onChange={(e) => setCompanyWebsite(e.target.value)}
              placeholder="e.g. https://example.com"
            />
          </div>

          {/* Result */}
          <div className="work-log-field-group">
            <label className="work-log-field-label">Result</label>
            <input
              type="text"
              className="input"
              value={result}
              onChange={(e) => setResult(e.target.value)}
              placeholder="e.g. Application filed"
            />
          </div>
        </div>

        {/* Error */}
        {error && <p className="modal-error px-2">{error}</p>}

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose} disabled={isPending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={isPending}
          >
            {isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
