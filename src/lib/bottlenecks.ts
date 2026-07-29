/** MG-1: manager/office bottleneck alerts from existing job columns. */

import { escapeHtml, statusLabel } from "./html";
import { printStatusLabel } from "./print";

export const COMPLETE_AGING_DAYS = 7;
export const BOTTLENECK_LIST_LIMIT = 6;

export type BottleneckKind =
	| "overdue_followups"
	| "missing_followup"
	| "unassigned_field"
	| "past_schedule"
	| "complete_not_invoiced"
	| "print_past_due"
	| "unassigned_print";

export type BottleneckRow = {
	id: string;
	title: string;
	href: string;
	customerName: string;
	detail: string;
};

export type BottleneckSection = {
	kind: BottleneckKind;
	title: string;
	moreHref: string;
	count: number;
	rows: BottleneckRow[];
};

export type BottleneckFieldFilters = {
	/** Already includes j.deleted_at / visibility / product scope. */
	whereSql: string;
	binds: string[];
};

export type BottleneckPrintFilters = {
	whereSql: string;
	binds: string[];
};

type CountRow = { n: number };

type ListedJob = {
	id: string;
	title: string;
	status: string;
	customer_name: string;
	detail: string | null;
};

async function fieldCount(
	db: D1Database,
	condition: string,
	filters: BottleneckFieldFilters,
	extraBinds: string[] = [],
): Promise<number> {
	const sql = `SELECT COUNT(*) AS n FROM jobs j
    WHERE ${condition}
      AND ${filters.whereSql}`;
	const row = await db
		.prepare(sql)
		.bind(...extraBinds, ...filters.binds)
		.first<CountRow>();
	return row?.n ?? 0;
}

async function fieldList(
	db: D1Database,
	condition: string,
	detailExpr: string,
	orderBy: string,
	filters: BottleneckFieldFilters,
	extraBinds: string[] = [],
): Promise<ListedJob[]> {
	const sql = `SELECT j.id, j.title, j.status, c.name AS customer_name,
      (${detailExpr}) AS detail
     FROM jobs j
     JOIN customers c ON c.id = j.customer_id
     WHERE ${condition}
       AND ${filters.whereSql}
     ORDER BY ${orderBy}
     LIMIT ${BOTTLENECK_LIST_LIMIT}`;
	const res = await db
		.prepare(sql)
		.bind(...extraBinds, ...filters.binds)
		.all<ListedJob>();
	return res.results ?? [];
}

async function printCount(
	db: D1Database,
	condition: string,
	filters: BottleneckPrintFilters,
	extraBinds: string[] = [],
): Promise<number> {
	const sql = `SELECT COUNT(*) AS n FROM print_jobs p
    WHERE ${condition}
      AND ${filters.whereSql}`;
	const row = await db
		.prepare(sql)
		.bind(...extraBinds, ...filters.binds)
		.first<CountRow>();
	return row?.n ?? 0;
}

async function printList(
	db: D1Database,
	condition: string,
	detailExpr: string,
	orderBy: string,
	filters: BottleneckPrintFilters,
	extraBinds: string[] = [],
): Promise<ListedJob[]> {
	const sql = `SELECT p.id, p.title, p.status, c.name AS customer_name,
      (${detailExpr}) AS detail
     FROM print_jobs p
     JOIN customers c ON c.id = p.customer_id
     WHERE ${condition}
       AND ${filters.whereSql}
     ORDER BY ${orderBy}
     LIMIT ${BOTTLENECK_LIST_LIMIT}`;
	const res = await db
		.prepare(sql)
		.bind(...extraBinds, ...filters.binds)
		.all<ListedJob>();
	return res.results ?? [];
}

function mapFieldRows(
	rows: ListedJob[],
	detailFn: (r: ListedJob) => string,
): BottleneckRow[] {
	return rows.map((r) => ({
		id: r.id,
		title: r.title,
		href: `/jobs/${r.id}`,
		customerName: r.customer_name,
		detail: detailFn(r),
	}));
}

function mapPrintRows(
	rows: ListedJob[],
	detailFn: (r: ListedJob) => string,
): BottleneckRow[] {
	return rows.map((r) => ({
		id: r.id,
		title: r.title,
		href: `/print/${r.id}`,
		customerName: r.customer_name,
		detail: detailFn(r),
	}));
}

function sliceDate(iso: string | null | undefined): string {
	if (!iso) return "—";
	return iso.slice(0, 10);
}

/**
 * Load product-scoped bottleneck sections for office staff.
 * Pass null field/print filters to skip that product lane.
 */
export async function loadBottleneckSections(
	db: D1Database,
	opts: {
		today: string;
		field: BottleneckFieldFilters | null;
		print: BottleneckPrintFilters | null;
	},
): Promise<BottleneckSection[]> {
	const sections: BottleneckSection[] = [];
	const { today, field, print } = opts;
	const agingBound = `-${COMPLETE_AGING_DAYS} days`;

	if (field) {
		{
			const condition = `j.status IN ('lead','estimate')
        AND j.follow_up_at IS NOT NULL
        AND date(j.follow_up_at) < date(?)`;
			const count = await fieldCount(db, condition, field, [today]);
			const rows = await fieldList(
				db,
				condition,
				"j.follow_up_at",
				"j.follow_up_at ASC",
				field,
				[today],
			);
			sections.push({
				kind: "overdue_followups",
				title: "Overdue lead follow-ups",
				moreHref: "/leads",
				count,
				rows: mapFieldRows(
					rows,
					(r) => `${statusLabel(r.status)} · due ${sliceDate(r.detail)}`,
				),
			});
		}

		{
			const condition = `j.status IN ('lead','estimate') AND j.follow_up_at IS NULL`;
			const count = await fieldCount(db, condition, field);
			const rows = await fieldList(
				db,
				condition,
				"j.updated_at",
				"j.updated_at ASC",
				field,
			);
			sections.push({
				kind: "missing_followup",
				title: "Leads/estimates missing follow-up date",
				moreHref: "/leads",
				count,
				rows: mapFieldRows(rows, (r) => statusLabel(r.status)),
			});
		}

		{
			const condition = `j.status IN ('scheduled','in_progress') AND j.assigned_user_id IS NULL`;
			const count = await fieldCount(db, condition, field);
			const rows = await fieldList(
				db,
				condition,
				"j.scheduled_start",
				"COALESCE(j.scheduled_start, j.updated_at) ASC",
				field,
			);
			sections.push({
				kind: "unassigned_field",
				title: "Unassigned scheduled / in-progress",
				moreHref: "/jobs?status=scheduled",
				count,
				rows: mapFieldRows(rows, (r) => statusLabel(r.status)),
			});
		}

		{
			const condition = `j.status IN ('scheduled','in_progress')
        AND j.scheduled_start IS NOT NULL
        AND date(j.scheduled_start) < date(?)`;
			const count = await fieldCount(db, condition, field, [today]);
			const rows = await fieldList(
				db,
				condition,
				"j.scheduled_start",
				"j.scheduled_start ASC",
				field,
				[today],
			);
			sections.push({
				kind: "past_schedule",
				title: "Past scheduled start (still open)",
				moreHref: "/jobs?status=in_progress",
				count,
				rows: mapFieldRows(
					rows,
					(r) => `${statusLabel(r.status)} · ${sliceDate(r.detail)}`,
				),
			});
		}

		{
			const condition = `j.status = 'complete'
        AND date(j.updated_at) <= date('now', ?)`;
			const count = await fieldCount(db, condition, field, [agingBound]);
			const rows = await fieldList(
				db,
				condition,
				"j.updated_at",
				"j.updated_at ASC",
				field,
				[agingBound],
			);
			sections.push({
				kind: "complete_not_invoiced",
				title: `Complete not invoiced (${COMPLETE_AGING_DAYS}+ days)`,
				moreHref: "/jobs?status=complete",
				count,
				rows: mapFieldRows(
					rows,
					(r) => `updated ${sliceDate(r.detail)}`,
				),
			});
		}
	}

	if (print) {
		{
			const condition = `p.due_date IS NOT NULL
        AND date(p.due_date) < date(?)
        AND p.status NOT IN ('delivered','cancelled')`;
			const count = await printCount(db, condition, print, [today]);
			const rows = await printList(
				db,
				condition,
				"p.due_date",
				"p.due_date ASC",
				print,
				[today],
			);
			sections.push({
				kind: "print_past_due",
				title: "Print past due",
				moreHref: "/print/board",
				count,
				rows: mapPrintRows(
					rows,
					(r) =>
						`${printStatusLabel(r.status)} · due ${sliceDate(r.detail)}`,
				),
			});
		}

		{
			const condition = `p.status IN ('intake','proof','approved','in_production','ready')
        AND p.assigned_user_id IS NULL`;
			const count = await printCount(db, condition, print);
			const rows = await printList(
				db,
				condition,
				"p.due_date",
				"COALESCE(p.due_date, p.updated_at) ASC",
				print,
			);
			sections.push({
				kind: "unassigned_print",
				title: "Unassigned active print jobs",
				moreHref: "/print/board",
				count,
				rows: mapPrintRows(rows, (r) => printStatusLabel(r.status)),
			});
		}
	}

	return sections;
}

/** Total jobs flagged across sections (sum of counts). */
export function bottleneckTotal(sections: BottleneckSection[]): number {
	return sections.reduce((sum, s) => sum + s.count, 0);
}

/** HTML for the Needs attention strip. */
export function renderBottleneckStrip(sections: BottleneckSection[]): string {
	const total = bottleneckTotal(sections);
	if (total === 0) {
		return `<div class="dash-attn dash-attn-ok">
      <h2>Needs attention</h2>
      <p class="muted" style="margin:0">Nothing flagged in your product lanes.</p>
    </div>`;
	}

	const blocks = sections
		.filter((s) => s.count > 0)
		.map((s) => {
			const rows =
				s.rows
					.map(
						(r) => `<tr>
          <td><a href="${escapeHtml(r.href)}">${escapeHtml(r.title)}</a></td>
          <td>${escapeHtml(r.customerName)}</td>
          <td>${escapeHtml(r.detail)}</td>
        </tr>`,
					)
					.join("") ||
				`<tr><td colspan="3" class="muted">Open the list to review.</td></tr>`;
			return `<div class="bn-block">
        <h3>${escapeHtml(s.title)} <span class="muted">(${s.count})</span></h3>
        <table>
          <thead><tr><th>Job</th><th>Customer</th><th>Detail</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="bn-more"><a href="${escapeHtml(s.moreHref)}">Open full list →</a></p>
      </div>`;
		})
		.join("\n");

	return `<div class="dash-attn">
    <h2>Needs attention <span class="muted" style="font-weight:500">(${total})</span></h2>
    ${blocks}
  </div>`;
}

/** Build print filter SQL for office bottleneck queries. */
export function printBottleneckFilters(
	visibility: { sql: string; binds: string[] },
): BottleneckPrintFilters {
	const where: string[] = ["p.deleted_at IS NULL", "p.status != 'cancelled'"];
	const binds: string[] = [];
	if (visibility.sql !== "1=1") {
		where.push(visibility.sql);
		binds.push(...visibility.binds);
	}
	return { whereSql: where.join(" AND "), binds };
}
