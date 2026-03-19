"use client"

import { useState, useTransition } from "react"
import { importCompanyScores } from "@/app/actions"
import { XIcon } from "@phosphor-icons/react"

// Modal for pasting JSON scores from Claude and importing them into the DB.
// Shows success/failure feedback with details on what was updated.

type ImportResult = {
  success: boolean
  updated: string[]
  notFound: string[]
  error?: string
}

export default function ImportScoresModal({ onClose }: { onClose: () => void }) {
  const [json, setJson] = useState("")
  const [result, setResult] = useState<ImportResult | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleImport() {
    startTransition(async () => {
      const res = await importCompanyScores(json)
      setResult(res)
      if (res.success && res.notFound.length === 0) {
        // Auto-close after a short delay on clean success
        setTimeout(onClose, 1500)
      }
    })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Import Scores</h2>
          <button onClick={onClose} className="btn btn-ghost" aria-label="Close">
            <XIcon size={20} />
          </button>
        </div>

        {!result ? (
          <>
            <textarea
              className="modal-textarea"
              placeholder="Paste JSON from Claude here..."
              value={json}
              onChange={(e) => setJson(e.target.value)}
              rows={12}
            />
            <div className="modal-footer">
              {isPending && <span className="status-text">Importing...</span>}
              <button
                onClick={handleImport}
                disabled={!json.trim() || isPending}
                className="btn btn-primary"
              >
                Import
              </button>
            </div>
          </>
        ) : (
          <div className="modal-result">
            {result.error ? (
              <p className="modal-error">{result.error}</p>
            ) : (
              <>
                {result.updated.length > 0 && (
                  <div className="modal-success">
                    <p>Updated {result.updated.length} {result.updated.length === 1 ? "company" : "companies"}:</p>
                    <ul className="modal-list">
                      {result.updated.map((name) => (
                        <li key={name}>{name}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.notFound.length > 0 && (
                  <div className="modal-warning">
                    <p>{result.notFound.length} not found in database:</p>
                    <ul className="modal-list">
                      {result.notFound.map((name) => (
                        <li key={name}>{name}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
            <div className="modal-footer">
              <button onClick={onClose} className="btn btn-primary">
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
