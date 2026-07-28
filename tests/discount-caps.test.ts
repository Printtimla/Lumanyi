import { describe, expect, it } from "vitest";
import {
	canManageDiscountCaps,
	discountExceedsMaxPct,
	discountRequiresOwnerApproval,
	parseDiscountCapForm,
	writeoffExceedsMax,
} from "../src/lib/discount-caps";
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

describe("SA-6.4 discount caps", () => {
	it("only owner manages discount caps", () => {
		expect(canManageDiscountCaps(user("owner"))).toBe(true);
		expect(canManageDiscountCaps(user("dispatcher"))).toBe(false);
		expect(canManageDiscountCaps(user("tech"))).toBe(false);
	});

	it("parses settings form", () => {
		const ok = parseDiscountCapForm({
			max_discount_pct: "15",
			max_writeoff_dollars: "250.00",
			owner_approval_pct: "10",
		});
		expect(ok.ok).toBe(true);
		if (ok.ok) {
			expect(ok.max_discount_pct).toBe(15);
			expect(ok.max_writeoff_cents).toBe(25000);
			expect(ok.owner_approval_pct).toBe(10);
		}
		expect(
			parseDiscountCapForm({
				max_discount_pct: "10",
				max_writeoff_dollars: "0",
				owner_approval_pct: "20",
			}).ok,
		).toBe(false);
	});

	it("evaluates policy helpers for future UI", () => {
		const settings = {
			max_discount_pct: 15,
			max_writeoff_cents: 10000,
			owner_approval_pct: 10,
		};
		expect(discountExceedsMaxPct(20, settings)).toBe(true);
		expect(discountExceedsMaxPct(10, settings)).toBe(false);
		expect(writeoffExceedsMax(15000, settings)).toBe(true);
		expect(discountRequiresOwnerApproval(10, settings)).toBe(true);
		expect(discountRequiresOwnerApproval(5, settings)).toBe(false);
	});
});
