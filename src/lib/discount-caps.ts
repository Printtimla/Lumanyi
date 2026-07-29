/** SA-6.4: Owner write-off / discount caps (rules only until discount UI ships). */

import type { AppUser } from "./auth";
import { dollarsToCents, centsToDollarsInput } from "./price-list";

export type DiscountCapSettings = {
	max_discount_pct: number;
	max_writeoff_cents: number;
	owner_approval_pct: number;
	updated_at: string | null;
	updated_by: string | null;
};

export function canManageDiscountCaps(user: AppUser): boolean {
	return user.role === "owner";
}

export async function getDiscountCapSettings(
	db: D1Database,
): Promise<DiscountCapSettings> {
	const row = await db
		.prepare(
			`SELECT max_discount_pct, max_writeoff_cents, owner_approval_pct,
        updated_at, updated_by
       FROM discount_cap_settings WHERE id = 'default'`,
		)
		.first<{
			max_discount_pct: number;
			max_writeoff_cents: number;
			owner_approval_pct: number;
			updated_at: string | null;
			updated_by: string | null;
		}>();
	if (!row) {
		return {
			max_discount_pct: 0,
			max_writeoff_cents: 0,
			owner_approval_pct: 0,
			updated_at: null,
			updated_by: null,
		};
	}
	return row;
}

export function parseDiscountCapForm(form: Record<string, unknown>):
	| {
			ok: true;
			max_discount_pct: number;
			max_writeoff_cents: number;
			owner_approval_pct: number;
	  }
	| { ok: false; error: string } {
	const maxPct = parseFloat(String(form.max_discount_pct ?? "0"));
	const approvalPct = parseFloat(String(form.owner_approval_pct ?? "0"));
	const writeoff = dollarsToCents(form.max_writeoff_dollars);
	if (!Number.isFinite(maxPct) || maxPct < 0 || maxPct > 100) {
		return { ok: false, error: "Max discount % must be 0–100" };
	}
	if (!Number.isFinite(approvalPct) || approvalPct < 0 || approvalPct > 100) {
		return { ok: false, error: "Owner approval % must be 0–100" };
	}
	if (writeoff == null) {
		return { ok: false, error: "Max write-off $ required (≥ 0)" };
	}
	if (approvalPct > 0 && maxPct > 0 && approvalPct > maxPct) {
		return {
			ok: false,
			error: "Owner approval threshold cannot exceed max discount %",
		};
	}
	return {
		ok: true,
		max_discount_pct: maxPct,
		max_writeoff_cents: writeoff,
		owner_approval_pct: approvalPct,
	};
}

/**
 * Pure policy helpers for a future discount UI.
 * Opinion / not enforced yet: callers may use these when discount apply ships.
 */
export function discountExceedsMaxPct(
	discountPct: number,
	settings: Pick<DiscountCapSettings, "max_discount_pct">,
): boolean {
	if (settings.max_discount_pct <= 0) return false;
	return discountPct > settings.max_discount_pct;
}

export function writeoffExceedsMax(
	writeoffCents: number,
	settings: Pick<DiscountCapSettings, "max_writeoff_cents">,
): boolean {
	if (settings.max_writeoff_cents <= 0) return false;
	return writeoffCents > settings.max_writeoff_cents;
}

export function discountRequiresOwnerApproval(
	discountPct: number,
	settings: Pick<DiscountCapSettings, "owner_approval_pct">,
): boolean {
	if (settings.owner_approval_pct <= 0) return false;
	return discountPct >= settings.owner_approval_pct;
}

export function summarizeDiscountCaps(settings: DiscountCapSettings): string {
	const maxPct =
		settings.max_discount_pct > 0
			? `max discount ${settings.max_discount_pct}%`
			: "max discount unset (0%)";
	const writeoff =
		settings.max_writeoff_cents > 0
			? `max write-off $${centsToDollarsInput(settings.max_writeoff_cents)}`
			: "max write-off unset ($0)";
	const approval =
		settings.owner_approval_pct > 0
			? `Owner approval at ≥${settings.owner_approval_pct}%`
			: "no Owner approval threshold";
	return `${maxPct} · ${writeoff} · ${approval}`;
}

export function discountCapNoticeHtml(settings: DiscountCapSettings): string {
	return `Discount / write-off policy (enforced on invoices): ${summarizeDiscountCaps(settings)}.`;
}
