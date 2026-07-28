/** SA-6.3: Internal labor rates by designation (for margin — not payroll). */

import type { AppUser } from "./auth";
import { USER_ROLES, isValidUserRole, roleLabel, type UserRole } from "./roles";
import { dollarsToCents } from "./price-list";

export type LaborRateRow = {
	designation: string;
	hourly_cents: number;
	active: number;
	updated_at: string | null;
	updated_by: string | null;
};

export function canManageLaborRates(user: AppUser): boolean {
	return user.role === "owner";
}

export function laborRateDesignations(): Array<{ value: UserRole; label: string }> {
	return USER_ROLES.map((r) => ({ value: r.value, label: r.label }));
}

export async function listLaborRates(db: D1Database): Promise<LaborRateRow[]> {
	const result = await db
		.prepare(
			`SELECT designation, hourly_cents, active, updated_at, updated_by
       FROM labor_rates
       ORDER BY designation COLLATE NOCASE`,
		)
		.all<LaborRateRow>();
	return result.results ?? [];
}

export async function getLaborRate(
	db: D1Database,
	designation: string,
): Promise<LaborRateRow | null> {
	return db
		.prepare(
			`SELECT designation, hourly_cents, active, updated_at, updated_by
       FROM labor_rates WHERE designation = ?`,
		)
		.bind(designation)
		.first<LaborRateRow>();
}

/** Active rate cents for a designation, or null if missing/inactive/zero. */
export async function activeHourlyCents(
	db: D1Database,
	designation: string,
): Promise<number | null> {
	const row = await getLaborRate(db, designation);
	if (!row || !row.active || row.hourly_cents <= 0) return null;
	return row.hourly_cents;
}

export function parseLaborRateForm(form: Record<string, unknown>):
	| { ok: true; designation: UserRole; hourly_cents: number; active: number }
	| { ok: false; error: string } {
	const designation = String(form.designation || "").trim();
	if (!isValidUserRole(designation)) {
		return { ok: false, error: "Invalid designation" };
	}
	const hourly = dollarsToCents(form.hourly_dollars);
	if (hourly == null) {
		return { ok: false, error: "Hourly rate required (≥ 0)" };
	}
	const active = String(form.active || "1") === "1" ? 1 : 0;
	return { ok: true, designation, hourly_cents: hourly, active };
}

export function laborCostPrefill(designation: string, hourlyCents: number): {
	category: "labor";
	description: string;
	unit: "hr";
	unit_dollars: string;
} {
	return {
		category: "labor",
		description: `${roleLabel(designation)} hours`,
		unit: "hr",
		unit_dollars: (hourlyCents / 100).toFixed(2),
	};
}
