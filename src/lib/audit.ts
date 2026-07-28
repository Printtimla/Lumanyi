/** SA-5: Append-only audit ledger. */

import type { AppUser } from "./auth";
import { newId } from "./ids";

export type AuditAction =
	| "soft_delete"
	| "restore"
	| "hard_delete"
	| "void"
	| "user_create"
	| "user_deactivate"
	| "user_reactivate"
	| "user_designation"
	| "user_products"
	| "price_list_create"
	| "price_list_update"
	| "price_list_deactivate"
	| "price_list_reactivate";

export type AuditEntityType =
	| "customer"
	| "job"
	| "print_job"
	| "field_log"
	| "job_photo"
	| "moisture_map"
	| "user"
	| "price_list_item";

export type AuditEventInput = {
	actorUserId: string | null;
	action: AuditAction;
	entityType: AuditEntityType;
	entityId: string;
	summary: string;
	detail?: Record<string, unknown> | null;
	ip?: string | null;
	requestId?: string | null;
};

/** Owner-only audit viewer (same seat as Trash). */
export function canViewAudit(user: AppUser): boolean {
	return user.role === "owner";
}

export function clientIpFromHeaders(headers: {
	get(name: string): string | null;
}): string | null {
	const cf = headers.get("cf-connecting-ip");
	if (cf) return cf.trim().slice(0, 64);
	const xff = headers.get("x-forwarded-for");
	if (xff) return xff.split(",")[0]?.trim().slice(0, 64) || null;
	return null;
}

export function requestIdFromHeaders(headers: {
	get(name: string): string | null;
}): string {
	const ray = headers.get("cf-ray");
	if (ray) return ray.trim().slice(0, 64);
	return newId("req");
}

/** Insert one audit row. Never updates or deletes existing rows. */
export async function writeAuditEvent(
	db: D1Database,
	input: AuditEventInput,
): Promise<void> {
	const detail =
		input.detail == null ? null : JSON.stringify(input.detail).slice(0, 4000);
	await db
		.prepare(
			`INSERT INTO audit_events (
        id, actor_user_id, action, entity_type, entity_id, summary, detail, ip, request_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			newId("aud"),
			input.actorUserId,
			input.action,
			input.entityType,
			input.entityId,
			input.summary.slice(0, 500),
			detail,
			input.ip ?? null,
			input.requestId ?? null,
		)
		.run();
}

export type AuditListRow = {
	id: string;
	created_at: string;
	actor_user_id: string | null;
	actor_name: string | null;
	action: string;
	entity_type: string;
	entity_id: string;
	summary: string;
	detail: string | null;
	ip: string | null;
	request_id: string | null;
};

export async function listAuditEvents(
	db: D1Database,
	limit = 200,
): Promise<AuditListRow[]> {
	const capped = Math.min(Math.max(limit, 1), 500);
	const result = await db
		.prepare(
			`SELECT e.id, e.created_at, e.actor_user_id, u.name AS actor_name,
        e.action, e.entity_type, e.entity_id, e.summary, e.detail, e.ip, e.request_id
       FROM audit_events e
       LEFT JOIN users u ON u.id = e.actor_user_id
       ORDER BY e.created_at DESC
       LIMIT ?`,
		)
		.bind(capped)
		.all<AuditListRow>();
	return result.results ?? [];
}
