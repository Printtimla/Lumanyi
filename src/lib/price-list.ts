/** SA-6.1: Owner price lists for restoration + floors estimates. */

import type { AppUser } from "./auth";
import type { ProductKey } from "./products";
import { COST_CATEGORIES, isValidCostCategory, type CostCategory } from "./job-costs";

export const PRICE_LIST_PRODUCTS = [
	{ value: "restoration", label: "Mitigation / Restoration" },
	{ value: "floors", label: "Hard floors" },
] as const;

export type PriceListProduct = (typeof PRICE_LIST_PRODUCTS)[number]["value"];

export type PriceListItem = {
	id: string;
	product: PriceListProduct;
	category: CostCategory;
	name: string;
	unit: string;
	unit_cents: number;
	active: number;
	sort_order: number;
	notes: string | null;
};

export function canManagePriceLists(user: AppUser): boolean {
	return user.role === "owner";
}

export function isPriceListProduct(value: string): value is PriceListProduct {
	return PRICE_LIST_PRODUCTS.some((p) => p.value === value);
}

export function priceListProductLabel(product: string): string {
	return (
		PRICE_LIST_PRODUCTS.find((p) => p.value === product)?.label ??
		product.replace(/_/g, " ")
	);
}

export function priceListCategoryLabel(category: string): string {
	return (
		COST_CATEGORIES.find((c) => c.value === category)?.label ??
		category.replace(/_/g, " ")
	);
}

export function dollarsToCents(raw: unknown): number | null {
	const n = parseFloat(String(raw ?? "").trim());
	if (!Number.isFinite(n) || n < 0) return null;
	return Math.round(n * 100);
}

export function centsToDollarsInput(cents: number): string {
	return (cents / 100).toFixed(2);
}

export async function listPriceItems(
	db: D1Database,
	opts: { product?: PriceListProduct | ""; activeOnly?: boolean } = {},
): Promise<PriceListItem[]> {
	const where: string[] = ["1=1"];
	const binds: Array<string | number> = [];
	if (opts.product && isPriceListProduct(opts.product)) {
		where.push("product = ?");
		binds.push(opts.product);
	}
	if (opts.activeOnly) {
		where.push("active = 1");
	}
	const sql = `SELECT id, product, category, name, unit, unit_cents, active, sort_order, notes
     FROM price_list_items
     WHERE ${where.join(" AND ")}
     ORDER BY product, sort_order, name COLLATE NOCASE
     LIMIT 500`;
	const stmt = db.prepare(sql);
	const result = binds.length
		? await stmt.bind(...binds).all<PriceListItem>()
		: await stmt.all<PriceListItem>();
	return result.results ?? [];
}

export async function getPriceItem(
	db: D1Database,
	id: string,
): Promise<PriceListItem | null> {
	return db
		.prepare(
			`SELECT id, product, category, name, unit, unit_cents, active, sort_order, notes
       FROM price_list_items WHERE id = ?`,
		)
		.bind(id)
		.first<PriceListItem>();
}

/** Active items for a field product (estimate picker). */
export async function listActivePriceItemsForProduct(
	db: D1Database,
	product: ProductKey,
): Promise<PriceListItem[]> {
	if (product !== "restoration" && product !== "floors") return [];
	return listPriceItems(db, { product, activeOnly: true });
}

export function parsePriceListForm(form: Record<string, unknown>): {
	ok: true;
	product: PriceListProduct;
	category: CostCategory;
	name: string;
	unit: string;
	unitCents: number;
	notes: string | null;
	sortOrder: number;
} | {
	ok: false;
	error: string;
} {
	const product = String(form.product || "").trim();
	const category = String(form.category || "").trim();
	const name = String(form.name || "").trim();
	const unit = String(form.unit || "ea").trim() || "ea";
	const unitCents = dollarsToCents(form.unit_dollars);
	const sortRaw = parseInt(String(form.sort_order || "0"), 10);
	const notes = String(form.notes || "").trim() || null;

	if (!isPriceListProduct(product)) {
		return { ok: false, error: "Product must be restoration or floors" };
	}
	if (!isValidCostCategory(category)) {
		return { ok: false, error: "Invalid category" };
	}
	if (!name || name.length > 200) {
		return { ok: false, error: "Name required (max 200 chars)" };
	}
	if (unitCents == null) {
		return { ok: false, error: "Unit price required" };
	}
	return {
		ok: true,
		product,
		category,
		name,
		unit: unit.slice(0, 32),
		unitCents,
		notes,
		sortOrder: Number.isFinite(sortRaw) ? sortRaw : 0,
	};
}
