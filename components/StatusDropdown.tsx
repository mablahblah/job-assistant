"use client";

import { useState, useRef, useEffect } from "react";
import {
  QuestionIcon,
  BinocularsIcon,
  ThumbsDownIcon,
  PaperPlaneTiltIcon,
  ProhibitIcon,
  PhoneCallIcon,
  UsersThreeIcon,
  PenNibIcon,
  CheersIcon,
  CalendarXIcon,
  CaretDownIcon,
} from "@phosphor-icons/react";

// Map each status to its icon and semantic color variable
const STATUS_CONFIG: Record<string, { icon: React.ReactNode; color: string }> =
  {
    backlog: {
      icon: <QuestionIcon size={24} weight="regular" />,
      color: "var(--color-tertiary-text)",
    },
    "too far": {
      icon: <BinocularsIcon size={24} weight="regular" />,
      color: "var(--color-tertiary-text)",
    },
    "won't apply": {
      icon: <ThumbsDownIcon size={24} weight="regular" />,
      color: "var(--color-tertiary-text)",
    },
    "app. sent": {
      icon: <PaperPlaneTiltIcon size={24} weight="regular" />,
      color: "var(--color-highlight-text)",
    },
    rejected: {
      icon: <ProhibitIcon size={24} weight="regular" />,
      color: "var(--color-negative-text)",
    },
    screening: {
      icon: <PhoneCallIcon size={24} weight="regular" />,
      color: "var(--color-highlight-text)",
    },
    interview: {
      icon: <UsersThreeIcon size={24} weight="regular" />,
      color: "var(--color-highlight-text)",
    },
    test: {
      icon: <PenNibIcon size={24} weight="regular" />,
      color: "var(--color-highlight-text)",
    },
    offer: {
      icon: <CheersIcon size={24} weight="regular" />,
      color: "var(--color-positive-text)",
    },
    expired: {
      icon: <CalendarXIcon size={24} weight="regular" />,
      color: "var(--color-tertiary-text)",
    },
  };

// Reusable icon + label pair for status pill and menu items
// Reusable icon + label pair; icon color is per-status, text stays default
function StatusLabel({
  icon,
  label,
  iconColor,
}: {
  icon: React.ReactNode;
  label: string;
  iconColor?: string;
}) {
  return (
    <span className="status-label">
      <span style={{ color: iconColor, display: "inline-flex" }}>{icon}</span>
      <span>{label}</span>
    </span>
  );
}

const STATUS_OPTIONS = [
  "backlog",
  "won't apply",
  "app. sent",
  "rejected",
  "screening",
  "interview",
  "test",
  "offer",
  "too far",
  "expired",
];

// Dropdown pill that shows current job status, opens a menu to change it
export default function StatusDropdown({
  status,
  disabled,
  onSelect,
}: {
  status: string;
  disabled: boolean;
  onSelect: (status: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="status-dropdown" ref={wrapperRef}>
      {/* Pill button showing current status */}
      <button
        className="status-pill"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        title={status}
      >
        <StatusLabel
          icon={STATUS_CONFIG[status]?.icon}
          label={status}
          iconColor={STATUS_CONFIG[status]?.color}
        />
        <CaretDownIcon size={12} weight="bold" />
      </button>

      {/* Options menu */}
      {open && (
        <ul className="status-menu">
          <li className="status-menu-title">APPLICATION STATUS</li>
          {STATUS_OPTIONS.map((s) => (
            <li key={s}>
              <button
                className="status-menu-item"
                onClick={() => {
                  onSelect(s);
                  setOpen(false);
                }}
              >
                <StatusLabel
                  icon={STATUS_CONFIG[s]?.icon}
                  label={s}
                  iconColor={STATUS_CONFIG[s]?.color}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
