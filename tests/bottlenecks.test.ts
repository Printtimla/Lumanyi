import { describe, expect, it } from "vitest";
import {
	BOTTLENECK_LIST_LIMIT,
	COMPLETE_AGING_DAYS,
	bottleneckTotal,
	printBottleneckFilters,
	renderBottleneckStrip,
	type BottleneckSection,
} from "../src/lib/bottlenecks";

function section(
	partial: Partial<BottleneckSection> & Pick<BottleneckSection, "kind" | "count">,
): BottleneckSection {
	return {
		title: partial.title ?? partial.kind,
		moreHref: partial.moreHref ?? "/leads",
		rows: partial.rows ?? [],
		...partial,
	};
}

describe("MG-1 bottlenecks", () => {
	it("uses fixed aging and list limits", () => {
		expect(COMPLETE_AGING_DAYS).toBe(7);
		expect(BOTTLENECK_LIST_LIMIT).toBe(6);
	});

	it("sums section counts", () => {
		expect(
			bottleneckTotal([
				section({ kind: "overdue_followups", count: 2 }),
				section({ kind: "unassigned_field", count: 3 }),
				section({ kind: "print_past_due", count: 0 }),
			]),
		).toBe(5);
	});

	it("renders all-clear when nothing flagged", () => {
		const html = renderBottleneckStrip([
			section({ kind: "overdue_followups", count: 0 }),
		]);
		expect(html).toContain("Needs attention");
		expect(html).toContain("Nothing flagged");
		expect(html).toContain("dash-attn-ok");
	});

	it("renders only non-zero sections with escaped links", () => {
		const html = renderBottleneckStrip([
			section({
				kind: "unassigned_field",
				title: "Unassigned scheduled / in-progress",
				count: 1,
				rows: [
					{
						id: "job_1",
						title: "Water <loss>",
						href: "/jobs/job_1",
						customerName: "Acme & Co",
						detail: "scheduled",
					},
				],
			}),
			section({ kind: "print_past_due", count: 0 }),
		]);
		expect(html).toContain("Needs attention");
		expect(html).toContain("(1)");
		expect(html).toContain("Unassigned scheduled");
		expect(html).toContain("Water &lt;loss&gt;");
		expect(html).toContain("Acme &amp; Co");
		expect(html).not.toContain("Print past due");
	});

	it("builds print filters with deleted/cancelled guards", () => {
		const all = printBottleneckFilters({ sql: "1=1", binds: [] });
		expect(all.whereSql).toContain("p.deleted_at IS NULL");
		expect(all.whereSql).toContain("p.status != 'cancelled'");
		expect(all.binds).toEqual([]);

		const scoped = printBottleneckFilters({
			sql: "p.assigned_user_id = ?",
			binds: ["usr_1"],
		});
		expect(scoped.whereSql).toContain("p.assigned_user_id = ?");
		expect(scoped.binds).toEqual(["usr_1"]);
	});
});
