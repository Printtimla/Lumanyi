/** Soft-delete (archive) helpers — SA-2. */

import type { AppUser } from "./auth";

/** Owner-only trash vault + restore. */
export function canAccessTrash(user: AppUser): boolean {
	return user.role === "owner";
}

/** Office staff may archive (soft-delete); techs may not. */
export function canSoftDelete(user: AppUser): boolean {
	return user.role === "owner" || user.role === "dispatcher";
}

export const NOT_DELETED_SQL = "deleted_at IS NULL";
export const NOT_DELETED_J = "j.deleted_at IS NULL";
export const NOT_DELETED_P = "p.deleted_at IS NULL";
export const NOT_DELETED_C = "c.deleted_at IS NULL";
