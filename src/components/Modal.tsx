import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";

/** App-styled modal (replaces browser-native dialogs). Click backdrop or Esc to close. */
export function Modal({ title, onClose, children, maxWidth = "max-w-md" }: {
  title?: string;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className={`bg-white rounded-2xl border border-black w-full ${maxWidth} p-6`} onClick={(e) => e.stopPropagation()}>
        {title && (
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl">{title}</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-900" aria-label="Close"><X className="w-5 h-5" /></button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** Styled single-input dialog (replaces window.prompt). */
export function PromptModal({ title, label, placeholder, submitLabel = "Add", onSubmit, onClose }: {
  title: string;
  label?: string;
  placeholder?: string;
  submitLabel?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const submit = () => { const v = value.trim(); if (!v) return; onSubmit(v); onClose(); };
  return (
    <Modal title={title} onClose={onClose} maxWidth="max-w-sm">
      {label && <label className="block text-sm font-medium mb-1">{label}</label>}
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-black rounded-lg text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-gray-300"
      />
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50">Cancel</button>
        <button onClick={submit} disabled={!value.trim()} className="px-3 py-1.5 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50">{submitLabel}</button>
      </div>
    </Modal>
  );
}

/** Styled confirmation dialog (replaces window.confirm). */
export function ConfirmModal({ title, message, confirmLabel = "Confirm", danger, onConfirm, onClose }: {
  title?: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title ?? "Are you sure?"} onClose={onClose} maxWidth="max-w-sm">
      <p className="text-sm text-gray-600 mb-5">{message}</p>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50">Cancel</button>
        <button
          onClick={() => { onConfirm(); onClose(); }}
          className={`px-3 py-1.5 text-sm rounded-lg text-white ${danger ? "bg-red-600 hover:bg-red-700" : "bg-gray-900 hover:bg-gray-800"}`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
