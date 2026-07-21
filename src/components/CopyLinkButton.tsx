import { useState } from "react";
import { Link2, Check } from "lucide-react";

// Copies a shareable link to the current view. The address bar is kept in sync with the open
// event / series / page (see App.tsx), so the current URL *is* the deep link — we just copy it.
export function CopyLinkButton({ className = "", label = "Copy link" }: { className?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    try {
      void navigator.clipboard?.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — no-op */ }
  };
  return (
    <button
      onClick={copy}
      title="Copy a shareable link to this view"
      className={`inline-flex items-center gap-1 text-[13px] transition-colors ${copied ? "text-emerald-600" : "text-gray-500 hover:text-gray-900"} ${className}`}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}
