export const PRINT_PRODUCT_TYPES = [
	{ value: "flyer", label: "Flyer" },
	{ value: "brochure", label: "Brochure" },
	{ value: "postcard", label: "Postcard" },
	{ value: "banner", label: "Banner" },
	{ value: "business_card", label: "Business card" },
	{ value: "menu", label: "Menu" },
	{ value: "other", label: "Other" },
] as const;

export const PRINT_STATUSES = [
	{ value: "intake", label: "Intake" },
	{ value: "proof", label: "Proof" },
	{ value: "approved", label: "Approved" },
	{ value: "in_production", label: "In production" },
	{ value: "ready", label: "Ready" },
	{ value: "delivered", label: "Delivered" },
	{ value: "cancelled", label: "Cancelled" },
] as const;

/** Columns shown on the press / production board. */
export const PRINT_BOARD_COLUMNS = [
	"intake",
	"proof",
	"approved",
	"in_production",
	"ready",
] as const;

export const PRINT_FILE_KINDS = [
	{ value: "artwork", label: "Artwork" },
	{ value: "proof", label: "Proof" },
	{ value: "other", label: "Other" },
] as const;

export type PrintProductType = (typeof PRINT_PRODUCT_TYPES)[number]["value"];
export type PrintStatus = (typeof PRINT_STATUSES)[number]["value"];

export function printProductLabel(value: string): string {
	return PRINT_PRODUCT_TYPES.find((p) => p.value === value)?.label ?? value;
}

export function printStatusLabel(value: string): string {
	return PRINT_STATUSES.find((s) => s.value === value)?.label ?? value.replace(/_/g, " ");
}

export async function syncPrintQuoteTotal(
	db: D1Database,
	printJobId: string,
): Promise<number> {
	const row = await db
		.prepare(
			`SELECT COALESCE(SUM(quantity * unit_cents), 0) AS total
       FROM print_quote_lines WHERE print_job_id = ?`,
		)
		.bind(printJobId)
		.first<{ total: number }>();
	const total = Math.round(row?.total ?? 0);
	await db
		.prepare(
			`UPDATE print_jobs SET estimate_cents = ?, updated_at = datetime('now') WHERE id = ?`,
		)
		.bind(total, printJobId)
		.run();
	return total;
}
