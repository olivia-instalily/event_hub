import { useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@instalily/ui/dialog";
import { Button } from "@instalily/ui/button";
import { Input } from "@instalily/ui/input";

/** App modal, now backed by the brand Dialog. Same API (mounted = open, onClose to dismiss):
 *  Esc / backdrop / the built-in close button all route through onClose. */
export function Modal({ title, onClose, children, maxWidth = "max-w-md" }: {
  title?: string;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      {/* twMerge dedupes the size variant's sm:max-w-* against ours, so the caller's width wins. */}
      <DialogContent className={`${maxWidth} sm:${maxWidth}`}>
        {title && (
          <DialogHeader>
            <DialogTitle className="text-xl">{title}</DialogTitle>
          </DialogHeader>
        )}
        {children}
      </DialogContent>
    </Dialog>
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
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        placeholder={placeholder}
      />
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!value.trim()}>{submitLabel}</Button>
      </DialogFooter>
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
      <p className="text-sm text-muted-foreground">{message}</p>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? "destructive" : "default"} onClick={() => { onConfirm(); onClose(); }}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Modal>
  );
}
