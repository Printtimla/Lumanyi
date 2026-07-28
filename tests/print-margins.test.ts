import { describe, expect, it } from "vitest";
import {
	canManagePrintMargins,
	parseMarginSettingsForm,
	parseVolumeTiersJson,
	suggestedSellUnitCents,
	volumeMarkupPctForQty,
} from "../src/lib/print-margins";
import type { AppUser } from "../src/lib/auth";

function user(role: AppUser["role"]): AppUser {
	return {
		id: "u1",
		email: "a@b.c",
		name: "A",
		role,
		designation: role,
		products: ["restoration", "floors", "print"],
		mustChangePassword: false,
		active: true,
	};
}

describe("SA-6.2 print margins", () => {
	it("only owner manages print margins", () => {
		expect(canManagePrintMargins(user("owner"))).toBe(true);
		expect(canManagePrintMargins(user("dispatcher"))).toBe(false);
		expect(canManagePrintMargins(user("tech"))).toBe(false);
	});

	it("picks volume tier by quantity", () => {
		const tiers = [
			{ min_qty: 100, markup_pct: 5 },
			{ min_qty: 500, markup_pct: 10 },
			{ min_qty: 1000, markup_pct: 15 },
		];
		expect(volumeMarkupPctForQty(tiers, 50)).toBe(0);
		expect(volumeMarkupPctForQty(tiers, 100)).toBe(5);
		expect(volumeMarkupPctForQty(tiers, 750)).toBe(10);
		expect(volumeMarkupPctForQty(tiers, 2000)).toBe(15);
	});

	it("suggests sell unit from cost + markups + setup share", () => {
		// 1000¢ × 1.20 × 1.10 × 1.05 + 500/10 = 1386 + 50 = 1436
		const sell = suggestedSellUnitCents(1000, 10, {
			cost_plus_pct: 20,
			material_markup_pct: 10,
			setup_fee_cents: 500,
			volume_tiers: [{ min_qty: 10, markup_pct: 5 }],
		});
		expect(sell).toBe(1436);
	});

	it("parses settings form and volume tier JSON", () => {
		expect(parseVolumeTiersJson('[{"min_qty":100,"markup_pct":5}]')).toEqual([
			{ min_qty: 100, markup_pct: 5 },
		]);
		const parsed = parseMarginSettingsForm({
			cost_plus_pct: "25",
			material_markup_pct: "8",
			setup_fee_dollars: "15.00",
			tier_1_min: "250",
			tier_1_pct: "5",
		});
		expect(parsed.ok).toBe(true);
		if (parsed.ok) {
			expect(parsed.setup_fee_cents).toBe(1500);
			expect(parsed.volume_tiers).toEqual([{ min_qty: 250, markup_pct: 5 }]);
		}
	});
});
