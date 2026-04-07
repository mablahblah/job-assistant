"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  CheckCircleIcon,
  WarningCircleIcon,
  PencilSimpleIcon,
} from "@phosphor-icons/react";
import UseAnimations from "react-useanimations";
import { loading } from "@/lib/animations";
import {
  formatWeekLabel,
  groupEntriesByWeek,
  parseEnrichmentFlags,
  MIN_WEEKLY_ACTIVITIES,
} from "@/lib/work-search-weeks";
import type { WorkSearchEntryWithRelations } from "@/app/actions";
import EditWorkLogEntryModal from "./EditWorkLogEntryModal";

// How many weeks to show in the sidebar before collapsing to "Older"
const SIDEBAR_VISIBLE_WEEKS = 12;

interface Props {
  entries: WorkSearchEntryWithRelations[];
  weekSlots: string[]; // ISO strings of week-start Sundays, most-recent first
}

export default function WorkLogView({ entries, weekSlots }: Props) {
  const [activeWeek, setActiveWeek] = useState<string>(weekSlots[0] ?? "");
  const [editingEntry, setEditingEntry] = useState<WorkSearchEntryWithRelations | null>(null);
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  // Group entries by week key for O(1) lookup in the render loop
  const entriesByWeek = groupEntriesByWeek(entries);

  // Scroll spy: watch week section elements and highlight the topmost visible one
  useEffect(() => {
    const sections = Array.from(sectionRefs.current.entries());
    if (!sections.length) return;

    // Track which sections are intersecting — pick the topmost one as "active"
    const visible = new Set<string>();

    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver(
      (obs) => {
        for (const entry of obs) {
          const key = (entry.target as HTMLElement).dataset.weekKey!;
          if (entry.isIntersecting) {
            visible.add(key);
          } else {
            visible.delete(key);
          }
        }

        // Pick the week that appears earliest in weekSlots (most recent = top of page)
        const ordered = weekSlots.filter((w) => visible.has(w));
        if (ordered.length > 0) setActiveWeek(ordered[0]);
      },
      {
        // Bias toward sections crossing the top third of the viewport for stable highlighting
        rootMargin: "0px 0px -60% 0px",
        threshold: 0,
      }
    );

    for (const [, el] of sections) {
      observerRef.current.observe(el);
    }

    return () => observerRef.current?.disconnect();
  }, [weekSlots]);

  // Register a week section's DOM element so the scroll spy can observe it
  const registerSection = useCallback((key: string, el: HTMLElement | null) => {
    if (el) {
      el.dataset.weekKey = key;
      sectionRefs.current.set(key, el);
    } else {
      sectionRefs.current.delete(key);
    }
  }, []);

  // Scroll the main content area to the section for `weekKey`
  const scrollToWeek = (weekKey: string) => {
    const el = sectionRefs.current.get(weekKey);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // Scroll to the first "older" week (beyond the sidebar visible limit)
  const scrollToOlder = () => {
    const olderKey = weekSlots[SIDEBAR_VISIBLE_WEEKS];
    if (olderKey) scrollToWeek(olderKey);
  };

  const sidebarWeeks = weekSlots.slice(0, SIDEBAR_VISIBLE_WEEKS);
  const hasOlderWeeks = weekSlots.length > SIDEBAR_VISIBLE_WEEKS;

  return (
    <>
      <div className="work-log-layout">
        {/* ── Left sidebar ── */}
        <aside className="work-log-sidebar">
          <div className="work-log-sidebar-inner">
            <p className="work-log-sidebar-label">Weeks</p>
            {sidebarWeeks.map((weekKey) => {
              const weekEntries = entriesByWeek.get(weekKey) ?? [];
              const met = weekEntries.length >= MIN_WEEKLY_ACTIVITIES;
              const isActive = activeWeek === weekKey;

              return (
                <button
                  key={weekKey}
                  onClick={() => scrollToWeek(weekKey)}
                  className={`work-log-sidebar-item ${isActive ? "work-log-sidebar-item--active" : ""}`}
                  title={formatWeekLabel(new Date(weekKey))}
                >
                  <span className="work-log-sidebar-item-label">
                    {formatWeekLabel(new Date(weekKey))}
                  </span>
                  {met && (
                    <CheckCircleIcon
                      size={14}
                      weight="fill"
                      className="work-log-sidebar-check"
                      aria-label="3 activities met"
                    />
                  )}
                </button>
              );
            })}
            {hasOlderWeeks && (
              <button
                onClick={scrollToOlder}
                className="work-log-sidebar-older"
              >
                Older &darr;
              </button>
            )}
          </div>
        </aside>

        {/* ── Main content ── */}
        <div ref={mainRef} className="work-log-main">
          {weekSlots.length === 0 && (
            <p className="text-muted">No work search entries yet. Apply to jobs to start logging.</p>
          )}

          {weekSlots.map((weekKey) => {
            const weekEntries = entriesByWeek.get(weekKey) ?? [];
            const met = weekEntries.length >= MIN_WEEKLY_ACTIVITIES;
            const remaining = MIN_WEEKLY_ACTIVITIES - weekEntries.length;

            return (
              <section
                key={weekKey}
                ref={(el) => registerSection(weekKey, el)}
                className="work-log-week-section"
              >
                {/* Week header */}
                <div className="work-log-week-header">
                  <h2 className="work-log-week-title">
                    {formatWeekLabel(new Date(weekKey))}
                  </h2>
                  {met ? (
                    <span className="work-log-activity-met">
                      <CheckCircleIcon size={14} weight="fill" />
                      {MIN_WEEKLY_ACTIVITIES} activities met
                    </span>
                  ) : (
                    <span className="work-log-activity-needed">
                      {remaining} more required
                    </span>
                  )}
                </div>

                {/* Entry rows or empty state */}
                {weekEntries.length === 0 ? (
                  <p className="work-log-empty">No activities this week.</p>
                ) : (
                  <div className="work-log-entries">
                    {weekEntries.map((entry) => (
                      <EntryRow
                        key={entry.id}
                        entry={entry}
                        onEdit={() => setEditingEntry(entry)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {/* Edit modal */}
      {editingEntry && (
        <EditWorkLogEntryModal
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
        />
      )}
    </>
  );
}

// ── Company info slot — three states based on enrichmentStatus ──────────────

type CompanyInfo = {
  enrichmentStatus: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
};

function CompanyInfoSlot({ company }: { company: CompanyInfo }) {
  if (company.enrichmentStatus === "pending") {
    // Enrichment is in progress — centered in a grey placeholder box
    return (
      <div className="work-log-enrichment-placeholder">
        <UseAnimations animation={loading} size={14} loop />
        <span>Searching for company info...</span>
      </div>
    );
  }

  if (company.enrichmentStatus === "failed") {
    // Enrichment ran but returned no usable data — same placeholder box
    return (
      <div className="work-log-enrichment-placeholder">
        <span>Company info not found</span>
      </div>
    );
  }

  // complete or legacy null with data — render whatever fields exist
  return (
    <>
      {company.address && (
        <>
          <span className="work-log-entry-label" style={{ marginTop: "0.375rem" }}>Address</span>
          <span className="work-log-field-secondary">{company.address}</span>
        </>
      )}
      {company.phone && (
        <>
          <span className="work-log-entry-label" style={{ marginTop: "0.375rem" }}>Area Code + Phone #</span>
          <span className="work-log-field-secondary">{company.phone}</span>
        </>
      )}
      {company.website && (
        <>
          <span className="work-log-entry-label" style={{ marginTop: "0.375rem" }}>Website</span>
          <a href={company.website} target="_blank" rel="noopener noreferrer" className="work-log-field-link">
            {company.website}
          </a>
        </>
      )}
    </>
  );
}

// ── Single entry row ────────────────────────────────────────────────────────

interface EntryRowProps {
  entry: WorkSearchEntryWithRelations;
  onEdit: () => void;
}

function EntryRow({ entry, onEdit }: EntryRowProps) {
  const { job } = entry;
  const { company } = job;
  const flagLabels = parseEnrichmentFlags(company.enrichmentFlags);

  const dateLabel = new Date(entry.date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="work-log-entry">
      {/* 3-column grid matching TWC form columns */}
      <div className="work-log-entry-grid">
        {/* Column 1 — matches TWC "Date, Description of Work Search" */}
        <div className="work-log-entry-col">
          <span className="work-log-entry-label">Date of Activity</span>
          <span className="work-log-field-primary">{dateLabel}</span>
          <span className="work-log-entry-label" style={{ marginTop: "0.375rem" }}>Work Search Activity</span>
          <span className="work-log-field-secondary">{entry.activityType}</span>
          <span className="work-log-entry-label" style={{ marginTop: "0.375rem" }}>Type of Job</span>
          <span className="work-log-field-secondary">{job.title}</span>
        </div>

        {/* Column 2 — matches TWC "Name, Location and Telephone Number of Employer" */}
        <div className="work-log-entry-col">
          <span className="work-log-entry-label">Name</span>
          <span className="work-log-field-primary">{company.name}</span>
          <CompanyInfoSlot company={company} />
        </div>

        {/* Column 3 — matches TWC "Results" */}
        <div className="work-log-entry-col">
          <span className="work-log-entry-label">Results</span>
          <span className="work-log-field-primary">{entry.result}</span>
        </div>
      </div>

      {/* Toolbar — edit + enrichment alert */}
      <div className="work-log-entry-toolbar">
        <button
          className="work-log-edit-btn"
          onClick={onEdit}
          title="Edit this entry"
          aria-label="Edit entry"
        >
          <PencilSimpleIcon size={14} weight="bold" />
          Edit
        </button>

        {company.enrichmentUncertain && (
          <span
            className="work-log-enrichment-alert"
            title={flagLabels.join(" · ")}
            aria-label={`Enrichment warning: ${flagLabels.join(", ")}`}
          >
            <WarningCircleIcon size={14} weight="fill" />
            Enrichment uncertain
          </span>
        )}
      </div>
    </div>
  );
}
