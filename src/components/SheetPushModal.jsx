import { useState } from "react";
import { X, ExternalLink, Copy, Check } from "lucide-react";

export default function SheetPushModal({ sheetsUrl, onClose }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(sheetsUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="card p-5 w-full max-w-sm shadow-lg space-y-3.5 mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-ink">Report pushed</h3>
          <button
            onClick={onClose}
            className="text-muted hover:text-ink transition-colors"
            aria-label="Close"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <p className="text-xs text-muted">Report pushed to Google Sheets.</p>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={handleCopy}
            className="btn-secondary flex items-center gap-1.5"
          >
            {copied ? (
              <Check size={13} strokeWidth={2.5} className="text-ok" />
            ) : (
              <Copy size={13} strokeWidth={2} />
            )}
            {copied ? "Copied!" : "Copy link"}
          </button>
          <a
            href={sheetsUrl}
            target="_blank"
            rel="noreferrer"
            className="btn-primary flex items-center gap-1.5"
          >
            <ExternalLink size={13} strokeWidth={2} />
            Open in Google Sheets
          </a>
        </div>
      </div>
    </div>
  );
}
