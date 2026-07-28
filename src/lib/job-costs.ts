/** Job cost line helpers (internal tracking, not payroll). */

export const COST_CATEGORIES = [
	{ value: "labor", label: "Labor", defaultUnit: "hr" },
	{ value: "materials", label: "Materials", defaultUnit: "ea" },
	{ value: "equipment", label: "Equipment", defaultUnit: "day" },
	{ value: "other", label: "Other", defaultUnit: "ea" },
] as const;

export type CostCategory = (typeof COST_CATEGORIES)[number]["value"];

export type CostLineRow = {
	id: string;
	category: string;
	description: string;
	quantity: number;
	unit: string;
	unit_cents: number;
	sort_order: number;
};

export function costCategoryLabel(value: string | null | undefined): string {
	if (!value) return "—";
	const hit = COST_CATEGORIES.find((c) => c.value === value);
	return hit?.label ?? value.replace(/_/g, " ");
}

export function isValidCostCategory(value: string): value is CostCategory {
	return COST_CATEGORIES.some((c) => c.value === value);
}

export function defaultUnitForCategory(category: string): string {
	const hit = COST_CATEGORIES.find((c) => c.value === category);
	return hit?.defaultUnit ?? "ea";
}

export function lineTotalCents(quantity: number, unitCents: number): number {
	return Math.round(quantity * unitCents);
}

export function sumCostCents(lines: Array<{ quantity: number; unit_cents: number }>): number {
	return lines.reduce(
		(sum, line) => sum + lineTotalCents(line.quantity, line.unit_cents),
		0,
	);
}

/** Estimate − cost; null if estimate missing. */
export function marginCents(
	estimateCents: number | null | undefined,
	costCents: number,
): number | null {
	if (estimateCents == null) return null;
	return estimateCents - costCents;
}

export async function loadJobCostLines(
	db: D1Database,
	jobId: string,
): Promise<CostLineRow[]> {
	const rows = await db
		.prepare(
			`SELECT id, category, description, quantity, unit, unit_cents, sort_order
       FROM job_cost_lines WHERE job_id = ?
       ORDER BY sort_order, created_at`,
		)
		.bind(jobId)
		.all<CostLineRow>();
	return rows.results ?? [];
}

export async function sumJobCostCents(
	db: D1Database,
	jobId: string,
): Promise<number> {
	const row = await db
		.prepare(
			`SELECT COALESCE(SUM(quantity * unit_cents), 0) AS total
       FROM job_cost_lines WHERE job_id = ?`,
		)
		.bind(jobId)
		.first<{ total: number }>();
	return Math.round(row?.total ?? 0);
}
