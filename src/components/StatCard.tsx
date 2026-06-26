import type { ReactNode } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@instalily/ui/card";

/**
 * A stat tile on the brand Card primitive — the same look as @instalily/ui's MetricCard,
 * but it takes a pre-formatted value (so multi-currency works), an optional color accent
 * (e.g. the budget variance ring), and an optional onClick (so filter tiles stay clickable).
 */
export function StatCard({ label, value, sub, accent, onClick, active, title }: {
  label: string;
  value: ReactNode;   // pre-formatted, e.g. money(n, currency) or a count
  sub?: ReactNode;    // optional small line under the value
  accent?: string;    // optional ring color class, e.g. "ring-green-400"
  onClick?: () => void;
  active?: boolean;   // selected state (for filter tiles)
  title?: string;
}) {
  const clickable = !!onClick;
  return (
    <Card
      title={title}
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick!(); } } : undefined}
      className={`gap-2 bg-gradient-to-b from-primary/5 to-white to-60% ${accent ? `ring-2 ring-inset ${accent}` : ""} ${active ? "shadow-md ring-foreground/30" : ""} ${clickable ? "cursor-pointer text-left outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring" : ""}`}
    >
      <CardHeader className="gap-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">{value}</CardTitle>
        {sub && <div className="text-[15px]">{sub}</div>}
      </CardHeader>
    </Card>
  );
}
