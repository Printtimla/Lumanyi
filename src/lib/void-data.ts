/** SA-3: void claim-critical field data (moisture / photos / maps). */

import type { AppUser } from "./auth";

export const NOT_VOIDED_SQL = "voided_at IS NULL";
export const NOT_VOIDED_L = "l.voided_at IS NULL";

/** Anyone who can edit a field job may mark a row Incorrect / Void — not hard-delete. */
export function canVoidClaimData(user: AppUser): boolean {
	return (
		user.role === "owner" ||
		user.role === "manager" ||
		user.role === "dispatcher" ||
		user.role === "tech"
	);
}

const MIN_REASON = 3;
const MAX_REASON = 500;

/** Trim + length-check void reason. Returns null if invalid. */
export function normalizeVoidReason(raw: unknown): string | null {
	const reason = String(raw ?? "")
		.trim()
		.replace(/\s+/g, " ");
	if (reason.length < MIN_REASON || reason.length > MAX_REASON) return null;
	return reason;
}

/**
 * While an asset has an open job assignment, status must stay on_job.
 * Forces return-on-job before retired / available / maintenance.
 */
export function canSetAssetStatusWithOpenAssignment(
	nextStatus: string,
	hasOpenAssignment: boolean,
): boolean {
	if (!hasOpenAssignment) return true;
	return nextStatus === "on_job";
}
