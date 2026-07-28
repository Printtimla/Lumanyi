/** SA-4: Owner-only hard delete (break-glass) for Trash items. */

import type { AppUser } from "./auth";
import { verifyPassword } from "./password";

/** Same seat as Trash — Super Admin / Owner only. */
export function canHardDelete(user: AppUser): boolean {
	return user.role === "owner";
}

/**
 * Verify Owner password before irreversible wipe.
 * Empty password always fails.
 */
export async function verifyOwnerPasswordForHardDelete(
	password: unknown,
	passwordHash: string,
): Promise<boolean> {
	const pw = String(password ?? "");
	if (!pw) return false;
	return verifyPassword(pw, passwordHash);
}

export type HardDeleteResult =
	| { ok: true }
	| { ok: false; error: string; status: 400 | 404 };

/** Collect R2 keys for a field job (photos + moisture maps). */
export async function listFieldJobR2Keys(
	db: D1Database,
	jobId: string,
): Promise<string[]> {
	const photos = await db
		.prepare(`SELECT r2_key FROM job_photos WHERE job_id = ?`)
		.bind(jobId)
		.all<{ r2_key: string }>();
	const maps = await db
		.prepare(`SELECT r2_key FROM job_moisture_maps WHERE job_id = ?`)
		.bind(jobId)
		.all<{ r2_key: string }>();
	return [
		...(photos.results?.map((r) => r.r2_key) ?? []),
		...(maps.results?.map((r) => r.r2_key) ?? []),
	];
}

/** Collect R2 keys for a print job. */
export async function listPrintJobR2Keys(
	db: D1Database,
	printJobId: string,
): Promise<string[]> {
	const files = await db
		.prepare(`SELECT r2_key FROM print_files WHERE print_job_id = ?`)
		.bind(printJobId)
		.all<{ r2_key: string }>();
	return files.results?.map((r) => r.r2_key) ?? [];
}

async function deleteR2Keys(uploads: R2Bucket, keys: string[]): Promise<void> {
	// R2 delete accepts up to ~1000 keys; Trash items are small — batch simply.
	const chunk = 100;
	for (let i = 0; i < keys.length; i += chunk) {
		const slice = keys.slice(i, i + chunk);
		await Promise.all(slice.map((k) => uploads.delete(k)));
	}
}

/** Release inventory still assigned to this job before the job row is removed. */
async function releaseOpenEquipment(
	db: D1Database,
	jobId: string,
): Promise<void> {
	await db
		.prepare(
			`UPDATE equipment_assets
       SET status = 'available', updated_at = datetime('now')
       WHERE id IN (
         SELECT asset_id FROM job_equipment
         WHERE job_id = ? AND returned_at IS NULL
       )`,
		)
		.bind(jobId)
		.run();
}

/**
 * Permanently delete an archived field job + cascaded children + R2 objects.
 * Requires deleted_at IS NOT NULL.
 */
export async function hardDeleteFieldJob(
	db: D1Database,
	uploads: R2Bucket,
	jobId: string,
): Promise<HardDeleteResult> {
	const row = await db
		.prepare(`SELECT id, deleted_at FROM jobs WHERE id = ?`)
		.bind(jobId)
		.first<{ id: string; deleted_at: string | null }>();
	if (!row) return { ok: false, error: "Job not found", status: 404 };
	if (!row.deleted_at) {
		return {
			ok: false,
			error: "Archive the job first (Trash only).",
			status: 400,
		};
	}

	const keys = await listFieldJobR2Keys(db, jobId);
	await releaseOpenEquipment(db, jobId);
	await db.prepare(`DELETE FROM jobs WHERE id = ? AND deleted_at IS NOT NULL`).bind(jobId).run();
	await deleteR2Keys(uploads, keys);
	return { ok: true };
}

/**
 * Permanently delete an archived print job + files + R2 objects.
 */
export async function hardDeletePrintJob(
	db: D1Database,
	uploads: R2Bucket,
	printJobId: string,
): Promise<HardDeleteResult> {
	const row = await db
		.prepare(`SELECT id, deleted_at FROM print_jobs WHERE id = ?`)
		.bind(printJobId)
		.first<{ id: string; deleted_at: string | null }>();
	if (!row) return { ok: false, error: "Print job not found", status: 404 };
	if (!row.deleted_at) {
		return {
			ok: false,
			error: "Archive the print job first (Trash only).",
			status: 400,
		};
	}

	const keys = await listPrintJobR2Keys(db, printJobId);
	await db
		.prepare(`DELETE FROM print_jobs WHERE id = ? AND deleted_at IS NOT NULL`)
		.bind(printJobId)
		.run();
	await deleteR2Keys(uploads, keys);
	return { ok: true };
}

/**
 * Permanently delete an archived customer and all related jobs / print / recurring.
 * Cascades field + print jobs (including non-archived ones under this customer)
 * so FK constraints do not block a privacy wipe.
 */
export async function hardDeleteCustomer(
	db: D1Database,
	uploads: R2Bucket,
	customerId: string,
): Promise<HardDeleteResult> {
	const row = await db
		.prepare(`SELECT id, deleted_at FROM customers WHERE id = ?`)
		.bind(customerId)
		.first<{ id: string; deleted_at: string | null }>();
	if (!row) return { ok: false, error: "Customer not found", status: 404 };
	if (!row.deleted_at) {
		return {
			ok: false,
			error: "Archive the customer first (Trash only).",
			status: 400,
		};
	}

	const fieldJobs = await db
		.prepare(`SELECT id FROM jobs WHERE customer_id = ?`)
		.bind(customerId)
		.all<{ id: string }>();
	const printJobs = await db
		.prepare(`SELECT id FROM print_jobs WHERE customer_id = ?`)
		.bind(customerId)
		.all<{ id: string }>();

	const allKeys: string[] = [];
	for (const j of fieldJobs.results ?? []) {
		allKeys.push(...(await listFieldJobR2Keys(db, j.id)));
		await releaseOpenEquipment(db, j.id);
	}
	for (const p of printJobs.results ?? []) {
		allKeys.push(...(await listPrintJobR2Keys(db, p.id)));
	}

	await db
		.prepare(`DELETE FROM recurring_jobs WHERE customer_id = ?`)
		.bind(customerId)
		.run();
	await db
		.prepare(`DELETE FROM jobs WHERE customer_id = ?`)
		.bind(customerId)
		.run();
	await db
		.prepare(`DELETE FROM print_jobs WHERE customer_id = ?`)
		.bind(customerId)
		.run();
	await db
		.prepare(`DELETE FROM customers WHERE id = ? AND deleted_at IS NOT NULL`)
		.bind(customerId)
		.run();

	await deleteR2Keys(uploads, allKeys);
	return { ok: true };
}
