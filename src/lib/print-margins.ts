/** SA-6.2: Owner print margin rules (cost-plus, setup, volume, material). */

import type { AppUser } from "./auth";

export type VolumeTier = {
	min_qty: number;
	markup_pct: number;
};

export type PrintMarginSettings = {
	cost_plus_pct: number;
	material_markup_pct: number;
	setup_fee_cents: number;
	volume_tiers: VolumeTier[];
	updated_at: string | null;
	updated_by: string | null;
};

export function canManagePrintMargins(user: AppUser): boolean {
	return user.role === "owner";
}

export function parseVolumeTiersJson(raw: string | null | undefined): VolumeTier[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed
			.map((row) => {
				const min_qty = Number((row as VolumeTier).min_qty);
				const markup_pct = Number((row as VolumeTier).markup_pct);
				if (!Number.isFinite(min_qty) || min_qty < 0) return null;
				if (!Number.isFinite(markup_pct)) return null;
				return { min_qty, markup_pct };
			})
			.filter((t): t is VolumeTier => t != null)
			.sort((a, b) => a.min_qty - b.min_qty)
			.slice(0, 8);
	} catch {
		return [];
	}
}

export function serializeVolumeTiers(tiers: VolumeTier[]): string {
	return JSON.stringify(
		tiers
			.filter((t) => Number.isFinite(t.min_qty) && Number.isFinite(t.markup_pct))
			.sort((a, b) => a.min_qty - b.min_qty)
			.slice(0, 8),
	);
}

/** Highest tier whose min_qty <= quantity; 0 if none. */
export function volumeMarkupPctForQty(
	tiers: VolumeTier[],
	quantity: number,
): number {
	if (!Number.isFinite(quantity) || quantity < 0) return 0;
	let hit = 0;
	for (const tier of tiers) {
		if (quantity >= tier.min_qty) hit = tier.markup_pct;
	}
	return hit;
}

/**
 * Suggested sell unit cents from cost + Owner rules.
 * unit = cost × (1+cost_plus%) × (1+material%) × (1+volume%) + setup/qty
 * Setup is spread across the line quantity (0 qty → setup alone on unit).
 */
export function suggestedSellUnitCents(
	costUnitCents: number,
	quantity: number,
	settings: Pick<
		PrintMarginSettings,
		"cost_plus_pct" | "material_markup_pct" | "setup_fee_cents" | "volume_tiers"
	>,
): number {
	const cost = Math.max(0, costUnitCents);
	const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
	const volumePct = volumeMarkupPctForQty(settings.volume_tiers, qty);
	const marked =
		cost *
		(1 + settings.cost_plus_pct / 100) *
		(1 + settings.material_markup_pct / 100) *
		(1 + volumePct / 100);
	const setupShare = settings.setup_fee_cents / qty;
	return Math.max(0, Math.round(marked + setupShare));
}

export async function getPrintMarginSettings(
	db: D1Database,
): Promise<PrintMarginSettings> {
	const row = await db
		.prepare(
			`SELECT cost_plus_pct, material_markup_pct, setup_fee_cents, volume_tiers_json,
        updated_at, updated_by
       FROM print_margin_settings WHERE id = 'default'`,
		)
		.first<{
			cost_plus_pct: number;
			material_markup_pct: number;
			setup_fee_cents: number;
			volume_tiers_json: string;
			updated_at: string | null;
			updated_by: string | null;
		}>();
	if (!row) {
		return {
			cost_plus_pct: 0,
			material_markup_pct: 0,
			setup_fee_cents: 0,
			volume_tiers: [],
			updated_at: null,
			updated_by: null,
		};
	}
	return {
		cost_plus_pct: row.cost_plus_pct,
		material_markup_pct: row.material_markup_pct,
		setup_fee_cents: row.setup_fee_cents,
		volume_tiers: parseVolumeTiersJson(row.volume_tiers_json),
		updated_at: row.updated_at,
		updated_by: row.updated_by,
	};
}

export function parseMarginSettingsForm(form: Record<string, unknown>):
	| {
			ok: true;
			cost_plus_pct: number;
			material_markup_pct: number;
			setup_fee_cents: number;
			volume_tiers: VolumeTier[];
	  }
	| { ok: false; error: string } {
	const costPlus = parseFloat(String(form.cost_plus_pct ?? "0"));
	const material = parseFloat(String(form.material_markup_pct ?? "0"));
	const setupDollars = parseFloat(String(form.setup_fee_dollars ?? "0"));
	if (!Number.isFinite(costPlus) || costPlus < 0 || costPlus > 1000) {
		return { ok: false, error: "Cost-plus % must be 0–1000" };
	}
	if (!Number.isFinite(material) || material < 0 || material > 1000) {
		return { ok: false, error: "Material markup % must be 0–1000" };
	}
	if (!Number.isFinite(setupDollars) || setupDollars < 0) {
		return { ok: false, error: "Setup fee must be ≥ 0" };
	}

	const tiers: VolumeTier[] = [];
	for (let i = 1; i <= 5; i++) {
		const minRaw = String(form[`tier_${i}_min`] ?? "").trim();
		const pctRaw = String(form[`tier_${i}_pct`] ?? "").trim();
		if (!minRaw && !pctRaw) continue;
		const min_qty = parseFloat(minRaw || "0");
		const markup_pct = parseFloat(pctRaw || "0");
		if (!Number.isFinite(min_qty) || min_qty < 0) {
			return { ok: false, error: `Volume tier ${i}: invalid min qty` };
		}
		if (!Number.isFinite(markup_pct) || markup_pct < -100 || markup_pct > 1000) {
			return { ok: false, error: `Volume tier ${i}: invalid markup %` };
		}
		tiers.push({ min_qty, markup_pct });
	}

	return {
		ok: true,
		cost_plus_pct: costPlus,
		material_markup_pct: material,
		setup_fee_cents: Math.round(setupDollars * 100),
		volume_tiers: tiers.sort((a, b) => a.min_qty - b.min_qty),
	};
}

export function summarizeMarginSettings(settings: PrintMarginSettings): string {
	const tiers =
		settings.volume_tiers.length === 0
			? "no volume tiers"
			: settings.volume_tiers
					.map((t) => `≥${t.min_qty} → ${t.markup_pct}%`)
					.join(", ");
	return `Cost-plus ${settings.cost_plus_pct}% · material ${settings.material_markup_pct}% · setup $${(settings.setup_fee_cents / 100).toFixed(2)} · ${tiers}`;
}
