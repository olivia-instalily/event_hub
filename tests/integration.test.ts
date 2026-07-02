import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  createPlanningEvent, listBudgetLines, addBudgetLines, upsertBudgetLines,
  updateBudgetLine, setBudgetStatus, setBudgetLineTarget, settleEvent,
  backfillWrappedEvent, applyTemplateAdditions, enrichEventFromExtract, addBudgetActuals,
  addSourceMaterial, deleteSourceMaterial, importVendors,
} from "../src/lib/db";
import type { BackfillExtract } from "../src/lib/backfill";

// Integration tests against the LOCAL Supabase stack (`supabase start`). RLS is off and
// anon has CRUD grants, so we use a plain client for setup/assertions/cleanup.
const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const sb = createClient(url, anon, { auth: { persistSession: false } });

const RUN = `test-${Date.now()}`;
const evId = `evt-${RUN}`;
const cleanup: Array<() => Promise<unknown>> = [];
afterAll(async () => { for (const fn of cleanup.reverse()) { try { await fn(); } catch { /* best effort */ } } });

describe("createPlanningEvent atomicity", () => {
  it("creates the event + all template-derived children on the happy path", async () => {
    const id = await createPlanningEvent({
      name: `${RUN} happy`, date: "2026-09-01", location: "NYC", tags: ["Recruiting"],
      phases: [{ name: "Plan", order: 0 }, { name: "Wrap", order: 1 }],
      template: {
        vendorCategories: ["Venue", "Catering"],
        budgetLines: [{ label: "Venue", estimate: 1000 }],
        progressCategories: ["Book venue", "Send invites"],
      },
    });
    cleanup.push(async () => {
      const { data: b } = await sb.from("budget").select("id").eq("event_id", id);
      for (const row of b ?? []) await sb.from("budget_line").delete().eq("budget_id", row.id);
      await sb.from("budget").delete().eq("event_id", id);
      await sb.from("engagement").delete().eq("event_id", id);
      await sb.from("deliverable").delete().eq("event_id", id);
      await sb.from("event").delete().eq("id", id);
    });

    const [{ count: evCount }, { count: engCount }, { count: budCount }, { count: delCount }] = await Promise.all([
      sb.from("event").select("id", { count: "exact", head: true }).eq("id", id),
      sb.from("engagement").select("id", { count: "exact", head: true }).eq("event_id", id),
      sb.from("budget").select("id", { count: "exact", head: true }).eq("event_id", id),
      sb.from("deliverable").select("id", { count: "exact", head: true }).eq("event_id", id),
    ]);
    expect(evCount).toBe(1);
    expect(engCount).toBe(2);
    expect(budCount).toBe(1);
    expect(delCount).toBe(3); // 2 workstreams + the locked post-mortem
  });

  it("rolls back ALL inserts if any child insert fails", async () => {
    const id = `evt-${RUN}-fail`;
    // Deliverable with a null title violates NOT NULL — the whole RPC transaction must abort.
    const { error } = await sb.rpc("create_planning_event", {
      p_event: { id, name: `${RUN} fail`, tags: ["Recruiting"], macro_stage: "Planning" },
      p_engagements: [{ id: `eng-${RUN}-f`, event_id: id, category: "Venue", stage: "Sourced" }],
      p_budget: { id: `bud-${RUN}-f`, event_id: id, currency: "USD" },
      p_budget_lines: [{ id: `bl-${RUN}-f`, budget_id: `bud-${RUN}-f`, label: "Venue", confirmed_amount: 100 }],
      p_deliverables: [{ id: `del-${RUN}-f`, event_id: id, title: null, phase: "Plan", status: "Todo", locked: false }],
    });
    expect(error).toBeTruthy(); // the call failed…

    // …and nothing partial was committed.
    const [{ count: ev }, { count: eng }, { count: bud }, { count: bl }] = await Promise.all([
      sb.from("event").select("id", { count: "exact", head: true }).eq("id", id),
      sb.from("engagement").select("id", { count: "exact", head: true }).eq("id", `eng-${RUN}-f`),
      sb.from("budget").select("id", { count: "exact", head: true }).eq("id", `bud-${RUN}-f`),
      sb.from("budget_line").select("id", { count: "exact", head: true }).eq("id", `bl-${RUN}-f`),
    ]);
    expect(ev).toBe(0);
    expect(eng).toBe(0);
    expect(bud).toBe(0);
    expect(bl).toBe(0);
  });
});

describe("attendee upsert (luma-sync pattern)", () => {
  it("does not duplicate on re-run and preserves a manually-set type", async () => {
    const email = `${RUN}@example.com`;
    const attId = `att-${RUN}`;
    cleanup.push(async () => { await sb.from("attendee").delete().eq("id", attId); });

    // First sync: brand-new row gets type 'Unknown' (Luma can't classify).
    await sb.from("attendee").upsert({ id: attId, email, name: "First", type: "Unknown" }, { onConflict: "email" });
    // A human re-classifies them.
    await sb.from("attendee").update({ type: "Partner" }).eq("id", attId);
    // Second sync: known row → type intentionally omitted (the script only sets type on new rows).
    await sb.from("attendee").upsert({ id: attId, email, name: "First Updated" }, { onConflict: "email" });

    const { data, count } = await sb.from("attendee").select("id, type, name", { count: "exact" }).eq("email", email);
    expect(count).toBe(1);                 // no duplicate
    expect(data?.[0].type).toBe("Partner"); // manual type preserved
    expect(data?.[0].name).toBe("First Updated"); // other fields still refresh
  });
});

describe("settle event (wrap & write-back)", () => {
  it("marks settled and carries deduped reflections back to the modeled-on template", async () => {
    const tmplId = `evt-${RUN}-tmpl`;
    const childId = `evt-${RUN}-child`;
    cleanup.push(async () => { await sb.from("event").delete().in("id", [tmplId, childId]); });

    await sb.from("event").insert({ id: tmplId, name: `${RUN} tmpl`, is_template: true, reflections: ["shared lesson"] });
    await sb.from("event").insert({ id: childId, name: `${RUN} child`, modeled_on_event_id: tmplId, reflections: ["shared lesson", "fresh lesson A", "fresh lesson B"] });

    const res = await settleEvent(childId);
    expect(res.settled).toBe(true);
    expect(res.template).toBe(tmplId);
    expect(res.reflectionsCarried).toBe(2); // only the two fresh ones; "shared lesson" deduped

    const { data: child } = await sb.from("event").select("settle_state, settled_at").eq("id", childId).single();
    expect(child?.settle_state).toBe("settled");
    expect(child?.settled_at).toBeTruthy();

    const { data: tmpl } = await sb.from("event").select("reflections").eq("id", tmplId).single();
    const refl = (tmpl?.reflections ?? []) as string[];
    expect(refl).toContain("fresh lesson A");
    expect(refl).toContain("fresh lesson B");
    expect(refl.filter((r) => r === "shared lesson").length).toBe(1); // not duplicated
  });
});

describe("backfill a past event", () => {
  it("creates a wrapped/settled event pointed at a template, and extends the template one-directionally", async () => {
    const tmplId = `evt-${RUN}-bftmpl`;
    cleanup.push(async () => { await sb.from("deliverable").delete().eq("event_id", tmplId); await sb.from("event").delete().eq("id", tmplId); });
    await sb.from("event").insert({ id: tmplId, name: `${RUN} fireside tmpl`, is_template: true, format: "Fireside", phases: [{ name: "Plan it", order: 0 }], staff_roles: ["Host"], reflections: ["Start outreach early"] });

    const x: BackfillExtract = {
      name: `${RUN} past fireside`, date: "2026-05-01", location: "NYC", format: "Fireside", tag: null,
      headcount: 60, turnoutActual: 40, budgetTotal: null, verdict: "went well",
      phases: ["Plan it", "Promote"], staffRoles: ["Host", "Photographer"],
      lessons: ["Over-order coffee"], heuristics: [], actuals: [{ line: "Venue", amount: 1200 }], deliverables: ["Book venue"],
    };
    const eventId = await backfillWrappedEvent(x, tmplId);
    cleanup.push(async () => {
      const { data: b } = await sb.from("budget").select("id").eq("event_id", eventId);
      for (const row of b ?? []) await sb.from("budget_line").delete().eq("budget_id", row.id);
      await sb.from("budget").delete().eq("event_id", eventId);
      await sb.from("deliverable").delete().eq("event_id", eventId);
      await sb.from("event").delete().eq("id", eventId);
    });

    const { data: ev } = await sb.from("event").select("settle_state, settled_at, modeled_on_event_id, checked_in, verdict, is_template").eq("id", eventId).single();
    expect(ev?.settle_state).toBe("settled");
    expect(ev?.modeled_on_event_id).toBe(tmplId);
    expect(ev?.checked_in).toBe(40);
    expect(ev?.verdict).toBe("went well");
    expect(ev?.is_template).toBe(false);

    // Extend the template with what this event surfaced; siblings/templates aren't otherwise rewritten.
    await applyTemplateAdditions(tmplId, { phases: ["Promote"], roles: ["Photographer"], lessons: ["Over-order coffee"] });
    const { data: t } = await sb.from("event").select("phases, staff_roles, reflections").eq("id", tmplId).single();
    expect((t?.phases as any[]).map((p) => p.name)).toEqual(expect.arrayContaining(["Plan it", "Promote"]));
    expect(t?.staff_roles).toEqual(expect.arrayContaining(["Host", "Photographer"]));
    expect(t?.reflections).toEqual(expect.arrayContaining(["Start outreach early", "Over-order coffee"]));
  });
});

describe("enrich a wrapped event from a dropped doc", () => {
  it("fills only the gap fields (budget + outcome) on the existing record", async () => {
    const eid = `evt-${RUN}-enrich`;
    const bid = `bud-${RUN}-enrich`;
    cleanup.push(async () => { await sb.from("budget_line").delete().eq("budget_id", bid); await sb.from("budget").delete().eq("id", bid); await sb.from("event").delete().eq("id", eid); });
    await sb.from("event").insert({ id: eid, name: `${RUN} enrich`, settle_state: "settled", tags: ["Brand & community event"] });
    await sb.from("budget").insert({ id: bid, event_id: eid, currency: "USD" });

    const x: BackfillExtract = {
      name: "", date: null, location: null, format: null, tag: null, headcount: null, turnoutActual: null,
      budgetTotal: null, verdict: "solid turnout, repeat", phases: [], staffRoles: [], lessons: [], heuristics: [],
      actuals: [{ line: "Catering", amount: 800 }], deliverables: [],
    };
    await enrichEventFromExtract(eid, x, ["budget", "outcome"]);

    const { data: ev } = await sb.from("event").select("verdict").eq("id", eid).single();
    expect(ev?.verdict).toBe("solid turnout, repeat");
    const lines = await listBudgetLines(bid);
    expect(lines.some((l) => l.label === "Catering" && l.confirmedAmount === 800)).toBe(true);
  });
});

describe("addBudgetActuals (dropped budget sheet → final spend)", () => {
  it("records lines as paid actuals on the event's budget, creating one if needed", async () => {
    const eid = `evt-${RUN}-actuals`;
    cleanup.push(async () => {
      const { data: b } = await sb.from("budget").select("id").eq("event_id", eid);
      for (const row of b ?? []) await sb.from("budget_line").delete().eq("budget_id", row.id);
      await sb.from("budget").delete().eq("event_id", eid);
      await sb.from("event").delete().eq("id", eid);
    });
    await sb.from("event").insert({ id: eid, name: `${RUN} actuals`, settle_state: "settled" });

    const n = await addBudgetActuals(eid, [{ label: "Venue", amount: 1200 }, { label: "Catering", amount: 800 }, { label: "  ", amount: 5 }]);
    expect(n).toBe(2); // blank label dropped

    const { data: bud } = await sb.from("budget").select("id").eq("event_id", eid).single();
    const { data: lines } = await sb.from("budget_line").select("label, confirmed_amount, payment_status").eq("budget_id", bud!.id);
    expect(lines).toHaveLength(2);
    expect(lines!.every((l) => l.payment_status === "paid")).toBe(true); // actual spend, not estimates
    expect(lines!.find((l) => l.label === "Venue")?.confirmed_amount).toBe(1200);
  });

  it("re-dropping the same sheet updates matching categories in place — no double entry", async () => {
    const eid = `evt-${RUN}-actuals-dedup`;
    cleanup.push(async () => {
      const { data: b } = await sb.from("budget").select("id").eq("event_id", eid);
      for (const row of b ?? []) await sb.from("budget_line").delete().eq("budget_id", row.id);
      await sb.from("budget").delete().eq("event_id", eid);
      await sb.from("event").delete().eq("id", eid);
    });
    await sb.from("event").insert({ id: eid, name: `${RUN} actuals dedup`, settle_state: "settled" });

    await addBudgetActuals(eid, [{ label: "Venue", amount: 1200 }, { label: "Catering", amount: 800 }]);
    // Same sheet again with one revised amount + a new category, plus a case/format variant of an
    // existing category — must NOT double any line.
    const n = await addBudgetActuals(eid, [{ label: "venue", amount: 1300 }, { label: "Catering", amount: 800 }, { label: "A/V", amount: 400 }]);
    expect(n).toBe(3); // 2 updated + 1 new

    const { data: bud } = await sb.from("budget").select("id").eq("event_id", eid).single();
    const { data: lines } = await sb.from("budget_line").select("label, confirmed_amount").eq("budget_id", bud!.id);
    expect(lines).toHaveLength(3); // Venue, Catering, A/V — not 5
    expect(lines!.find((l) => l.label!.toLowerCase() === "venue")?.confirmed_amount).toBe(1300); // updated in place
  });

  it("keeps distinct line items that share a canonical category (Food + Beverage both 'Catering')", async () => {
    const eid = `evt-${RUN}-actuals-distinct`;
    cleanup.push(async () => {
      const { data: b } = await sb.from("budget").select("id").eq("event_id", eid);
      for (const row of b ?? []) await sb.from("budget_line").delete().eq("budget_id", row.id);
      await sb.from("budget").delete().eq("event_id", eid);
      await sb.from("event").delete().eq("id", eid);
    });
    await sb.from("event").insert({ id: eid, name: `${RUN} actuals distinct`, settle_state: "settled" });

    const n = await addBudgetActuals(eid, [{ label: "Food (dinner)", amount: 8330.60 }, { label: "Beverage (wine + beer)", amount: 4346.40 }]);
    expect(n).toBe(2); // NOT merged into one "Catering" line

    const { data: bud } = await sb.from("budget").select("id").eq("event_id", eid).single();
    const { data: lines } = await sb.from("budget_line").select("confirmed_amount").eq("budget_id", bud!.id);
    expect(lines).toHaveLength(2);
    expect(lines!.reduce((s, l) => s + Number(l.confirmed_amount), 0)).toBeCloseTo(12677.0, 2); // no money dropped
  });
});

describe("importVendors (vendor-centric: one supplier tags many existing budget lines)", () => {
  it("makes ONE vendor for a supplier on many rows, tags existing lines (no re-price), filters taxes, and cascades on source removal", async () => {
    const eid = `evt-${RUN}-vendors`;
    const url = `https://x/${RUN}-vendors.csv`;
    cleanup.push(async () => {
      const { data: engs } = await sb.from("engagement").select("id").eq("event_id", eid);
      for (const e of engs ?? []) await sb.from("engagement_candidate").delete().eq("engagement_id", e.id);
      await sb.from("engagement").delete().eq("event_id", eid);
      const { data: b } = await sb.from("budget").select("id").eq("event_id", eid);
      for (const row of b ?? []) await sb.from("budget_line").delete().eq("budget_id", row.id);
      await sb.from("budget").delete().eq("event_id", eid);
      await sb.from("event").delete().eq("id", eid);
    });
    await sb.from("event").insert({ id: eid, name: `${RUN} vendors`, settle_state: "settled" });
    // Existing budget (from a prior budget-sheet drop) — these must be TAGGED, not re-created/re-priced.
    const budgetId = `bud-${RUN}-v`;
    await sb.from("budget").insert({ id: budgetId, event_id: eid, currency: "USD" });
    await sb.from("budget_line").insert([
      { id: `bl-${RUN}-food`, budget_id: budgetId, label: "Food (dinner)", confirmed_amount: 8330.6, payment_status: "estimate", doc_url: "https://x/budget.csv" },
      { id: `bl-${RUN}-bev`, budget_id: budgetId, label: "Beverage (wine + beer)", confirmed_amount: 4346.4, payment_status: "estimate", doc_url: "https://x/budget.csv" },
      { id: `bl-${RUN}-room`, budget_id: budgetId, label: "Room rental", confirmed_amount: 1448.8, payment_status: "estimate", doc_url: "https://x/budget.csv" },
    ]);
    await addSourceMaterial(eid, { name: "vendors.csv", url, type: "text/csv" });

    // ACE supplies food, beverage, room rental — plus an HST line that must be filtered out.
    const rows = [
      { category: "Food (dinner)", vendor: "ACE", amount: 8330.6, status: "Contracted", link: null, note: null },
      { category: "Beverage (wine + beer)", vendor: "ACE", amount: 4346.4, status: "Contracted", link: null, note: null },
      { category: "Room rental", vendor: "ACE", amount: 1448.8, status: "Contracted", link: null, note: null },
      { category: "HST (13%)", vendor: "ACE", amount: 1977.61, status: "Contracted", link: null, note: null },
    ];
    const r1 = await importVendors(eid, rows, url);
    expect(r1.vendors).toBe(1);   // ONE ACE vendor, not four
    expect(r1.tagged).toBe(3);    // three existing lines tagged
    expect(r1.skipped).toBe(1);   // HST filtered out

    const { data: engs } = await sb.from("engagement").select("id, category").eq("event_id", eid);
    expect(engs).toHaveLength(1);
    const aceId = engs![0].id;
    const { data: lines } = await sb.from("budget_line").select("label, confirmed_amount, payment_status, linked_engagement").eq("budget_id", budgetId);
    expect(lines).toHaveLength(3); // no new line for HST, no duplicates
    expect(lines!.every((l) => l.linked_engagement === aceId)).toBe(true);
    expect(lines!.every((l) => l.payment_status === "estimate")).toBe(true); // NOT flipped to paid
    expect(lines!.find((l) => l.label === "Food (dinner)")?.confirmed_amount).toBe(8330.6); // amount untouched

    // Idempotent re-drop.
    const r2 = await importVendors(eid, rows, url);
    expect(r2.vendors).toBe(0);
    const { data: engs2 } = await sb.from("engagement").select("id").eq("event_id", eid);
    expect(engs2).toHaveLength(1);

    // Remove the vendor sheet → vendor gone, lines untagged but KEPT (they came from budget.csv).
    const res = await deleteSourceMaterial(eid, url);
    expect(res.vendorsRemoved).toBe(1);
    expect(res.budgetLinesRemoved).toBe(0);
    const { data: engs3 } = await sb.from("engagement").select("id").eq("event_id", eid);
    expect(engs3).toHaveLength(0);
    const { data: lines3 } = await sb.from("budget_line").select("linked_engagement").eq("budget_id", budgetId);
    expect(lines3).toHaveLength(3); // budget intact
    expect(lines3!.every((l) => l.linked_engagement == null)).toBe(true); // untagged
  });
});

describe("deleteSourceMaterial cascade", () => {
  it("removes the doc from context and the budget lines derived solely from it (keeps others)", async () => {
    const eid = `evt-${RUN}-src`;
    const url = `https://x/${RUN}-budget.csv`;
    cleanup.push(async () => {
      const { data: b } = await sb.from("budget").select("id").eq("event_id", eid);
      for (const row of b ?? []) await sb.from("budget_line").delete().eq("budget_id", row.id);
      await sb.from("budget").delete().eq("event_id", eid);
      await sb.from("event").delete().eq("id", eid);
    });
    await sb.from("event").insert({ id: eid, name: `${RUN} src`, settle_state: "settled" });
    await addSourceMaterial(eid, { name: "budget.csv", url, type: "text/csv" });
    await addBudgetActuals(eid, [{ label: "Venue", amount: 1000 }, { label: "Catering", amount: 500 }], url); // from the sheet
    await addBudgetActuals(eid, [{ label: "Manual misc", amount: 50 }], null); // unrelated, no source

    const res = await deleteSourceMaterial(eid, url);
    expect(res.budgetLinesRemoved).toBe(2);

    const { data: ev } = await sb.from("event").select("source_materials").eq("id", eid).single();
    expect((ev?.source_materials as any[]).some((m) => m.url === url)).toBe(false); // removed from context
    const { data: bud } = await sb.from("budget").select("id").eq("event_id", eid).single();
    const { data: lines } = await sb.from("budget_line").select("label").eq("budget_id", bud!.id);
    expect(lines!.map((l) => l.label)).toEqual(["Manual misc"]); // sheet-derived gone, manual kept
  });
});

describe("budget replace (upsertBudgetLines)", () => {
  it("preserves manually-set fields, updates amounts, prunes missing, never deletes-then-adds", async () => {
    const budId = `bud-${RUN}-b`;
    const budEvId = `evt-${RUN}-b`;
    cleanup.push(async () => {
      await sb.from("budget_line").delete().eq("budget_id", budId);
      await sb.from("budget").delete().eq("id", budId);
      await sb.from("event").delete().eq("id", budEvId);
    });
    // budget requires an event/series (check: budget_attached_somewhere).
    await sb.from("event").insert({ id: budEvId, name: `${RUN} budget` });
    await sb.from("budget").insert({ id: budId, event_id: budEvId, currency: "USD" });

    // Seed: Venue (will get manual fields), plus an "Old" line that the re-import won't include.
    await addBudgetLines(budId, [{ label: "Venue", amount: 100 }, { label: "Old Thing", amount: 50 }]);
    const seeded = await listBudgetLines(budId);
    const venue = seeded.find((l) => l.label === "Venue")!;
    await setBudgetLineTarget(venue.id, 2000);
    await setBudgetStatus(venue.id, "paid");
    await updateBudgetLine(venue.id, { note: "deposit wired" });

    // Re-import: Venue at a new amount + a new Catering line; "Old Thing" is gone from the drop.
    await upsertBudgetLines(budId, [{ label: "Venue", amount: 500 }, { label: "Catering", amount: 300 }], { pruneMissing: true });

    const after = await listBudgetLines(budId);
    const v2 = after.find((l) => l.label === "Venue");
    expect(v2).toBeTruthy();
    expect(v2!.id).toBe(venue.id);            // same row, not delete-then-add
    expect(v2!.confirmedAmount).toBe(500);    // amount updated
    expect(v2!.target).toBe(2000);            // manual fields preserved
    expect(v2!.status).toBe("paid");
    expect(v2!.note).toBe("deposit wired");
    expect(after.some((l) => l.label === "Catering")).toBe(true);   // new category added
    expect(after.some((l) => l.label === "Old Thing")).toBe(false); // missing category pruned
  });
});
