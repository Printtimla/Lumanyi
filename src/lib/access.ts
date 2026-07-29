/** Role / product access control (server-side). */

import type { AppUser } from "./auth";
import type { ProductKey } from "./products";
import { isFloorType, isRestorationType, productForJobType } from "./products";

export const ALL_PRODUCTS: ProductKey[] = ["restoration", "floors", "print"];

export type FieldJobAccess = {
	id: string;
	status: string;
	assigned_user_id: string | null;
	job_type: string;
	deleted_at?: string | null;
};

export type PrintJobAccess = {
	id: string;
	status: string;
	assigned_user_id: string | null;
	deleted_at?: string | null;
};

export function parseProducts(raw: string | null | undefined): ProductKey[] {
	if (!raw || !String(raw).trim()) return [...ALL_PRODUCTS];
	const parts = String(raw)
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const out = ALL_PRODUCTS.filter((p) => parts.includes(p));
	return out.length ? out : [...ALL_PRODUCTS];
}

export function serializeProducts(products: ProductKey[]): string {
	return ALL_PRODUCTS.filter((p) => products.includes(p)).join(",");
}

/** Read product_* checkboxes from a parsed form body. Empty → []. */
export function productsSelectedFromForm(
	form: Record<string, unknown>,
): ProductKey[] {
	const selected: ProductKey[] = [];
	for (const p of ALL_PRODUCTS) {
		const key = `product_${p}`;
		const v = form[key];
		if (v === "on" || v === "1" || v === "true" || v === p) selected.push(p);
	}
	return selected;
}

/** Read product_* checkboxes; if none checked, fall back to all products. */
export function productsFromForm(form: Record<string, unknown>): ProductKey[] {
	const selected = productsSelectedFromForm(form);
	return selected.length ? selected : [...ALL_PRODUCTS];
}

export function canAccessProduct(user: AppUser, product: ProductKey): boolean {
	return user.products.includes(product);
}

/** Owner / Manager / Dispatcher — full visibility within product scope. */
export function isOfficeStaff(user: AppUser): boolean {
	return (
		user.role === "owner" ||
		user.role === "manager" ||
		user.role === "dispatcher"
	);
}

export function canViewAllJobs(user: AppUser): boolean {
	return isOfficeStaff(user);
}

export function canReopenJobs(user: AppUser): boolean {
	return isOfficeStaff(user);
}

export function canManageUsers(user: AppUser): boolean {
	return user.role === "owner";
}

/** Office nav: customers, leads, reports, recurring. */
export function canSeeOfficeTools(user: AppUser): boolean {
	return isOfficeStaff(user);
}

export function isStatusLocked(status: string): boolean {
	return status === "complete" || status === "invoiced";
}

/** Print jobs lock after delivery (or cancel). */
export function isPrintStatusLocked(status: string): boolean {
	return status === "delivered" || status === "cancelled";
}

export function canReadFieldJob(user: AppUser, job: FieldJobAccess): boolean {
	if (job.deleted_at && user.role !== "owner") return false;
	if (!canAccessProduct(user, productForJobType(job.job_type))) return false;
	if (canViewAllJobs(user)) return true;
	return job.assigned_user_id === user.id;
}

export function canWriteFieldJob(user: AppUser, job: FieldJobAccess): boolean {
	if (job.deleted_at) return false;
	if (!canReadFieldJob(user, job)) return false;
	if (isStatusLocked(job.status) && !canReopenJobs(user)) return false;
	if (canViewAllJobs(user)) return true;
	return job.assigned_user_id === user.id;
}

export function canReadPrintJob(user: AppUser, job: PrintJobAccess): boolean {
	if (job.deleted_at && user.role !== "owner") return false;
	if (!canAccessProduct(user, "print")) return false;
	if (canViewAllJobs(user)) return true;
	return job.assigned_user_id === user.id;
}

export function canWritePrintJob(user: AppUser, job: PrintJobAccess): boolean {
	if (job.deleted_at) return false;
	if (!canReadPrintJob(user, job)) return false;
	if (isPrintStatusLocked(job.status) && !canReopenJobs(user)) return false;
	if (canViewAllJobs(user)) return true;
	return job.assigned_user_id === user.id;
}

/**
 * Append assignment + product-scope filters for field job lists (alias `j`).
 * Mutates `where` / `binds` in place.
 */
export function appendFieldJobListFilters(
	user: AppUser,
	where: string[],
	binds: string[],
	restorationTypes: readonly string[],
	floorTypes: readonly string[],
): void {
	where.push("j.deleted_at IS NULL");
	const vis = fieldJobVisibility(user);
	if (vis.sql !== "1=1") {
		where.push(vis.sql);
		binds.push(...vis.binds);
	}

	const hasR = canAccessProduct(user, "restoration");
	const hasF = canAccessProduct(user, "floors");
	if (!hasR && !hasF) {
		where.push("0=1");
		return;
	}
	if (hasR && hasF) return;

	if (hasR) {
		where.push(
			`j.job_type IN (${restorationTypes.map(() => "?").join(",")})`,
		);
		binds.push(...restorationTypes);
	} else {
		where.push(`j.job_type IN (${floorTypes.map(() => "?").join(",")})`);
		binds.push(...floorTypes);
	}
}

/** SQL fragment + binds for field job lists (alias `j`). */
export function fieldJobVisibility(
	user: AppUser,
): { sql: string; binds: string[] } {
	if (canViewAllJobs(user)) return { sql: "1=1", binds: [] };
	return { sql: "j.assigned_user_id = ?", binds: [user.id] };
}

export function printJobVisibility(
	user: AppUser,
): { sql: string; binds: string[] } {
	if (canViewAllJobs(user)) return { sql: "1=1", binds: [] };
	return { sql: "p.assigned_user_id = ?", binds: [user.id] };
}

export function productLabel(product: ProductKey): string {
	if (product === "restoration") return "Restoration";
	if (product === "floors") return "Floors";
	return "Print";
}

export function jobTypeAllowedForUser(user: AppUser, jobType: string): boolean {
	if (isRestorationType(jobType) || jobType === "restoration") {
		return canAccessProduct(user, "restoration");
	}
	if (isFloorType(jobType)) return canAccessProduct(user, "floors");
	return false;
}
