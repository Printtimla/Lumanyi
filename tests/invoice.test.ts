import { describe, expect, it } from "vitest";
import {
	canManageInvoices,
	computeInvoiceTotals,
	parseInvoiceDiscountForm,
	sumLineSubtotal,
	validateInvoiceDiscounts,
} from "../src/lib/invoice";
import type { AppUser } from "../src/lib/auth";
import type { DiscountCapSettings } from "../src/lib/discount-caps";

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

const caps = (partial: Partial<DiscountCapSettings> = {}): DiscountCapSettings => ({
	max_discount_pct: 15,
	max_writeoff_cents: 5000,
	owner_approval_pct: 10,
	updated_at: null,
	updated_by: null,
	...partial,
});

describe("MG-3.1 invoices", () => {
	it("office can manage invoices; tech cannot", () => {
		expect(canManageInvoices(user("owner"))).toBe(true);
		expect(canManageInvoices(user("manager"))).toBe(true);
		expect(canManageInvoices(user("dispatcher"))).toBe(true);
		expect(canManageInvoices(user("tech"))).toBe(false);
	});

	it("computes discount and write-off totals", () => {
		expect(
			computeInvoiceTotals({
				subtotalCents: 10000,
				discountPct: 10,
				writeoffCents: 500,
			}),
		).toEqual({ discountCents: 1000, totalCents: 8500 });
		expect(sumLineSubtotal([{ description: "a", quantity: 2, unit: "ea", unit_cents: 250 }])).toBe(
			500,
		);
	});

	it("enforces SA-6.4 hard caps on save", () => {
		expect(
			validateInvoiceDiscounts({
				user: user("manager"),
				settings: caps(),
				discountPct: 20,
				writeoffCents: 0,
				action: "save",
			}).ok,
		).toBe(false);
		expect(
			validateInvoiceDiscounts({
				user: user("manager"),
				settings: caps(),
				discountPct: 5,
				writeoffCents: 6000,
				action: "save",
			}).ok,
		).toBe(false);
	});

	it("requires Owner for approval-threshold discounts", () => {
		const managerApprove = validateInvoiceDiscounts({
			user: user("manager"),
			settings: caps(),
			discountPct: 12,
			writeoffCents: 0,
			action: "approve",
		});
		expect(managerApprove.ok).toBe(false);
		expect(
			validateInvoiceDiscounts({
				user: user("owner"),
				settings: caps(),
				discountPct: 12,
				writeoffCents: 0,
				action: "approve",
			}).ok,
		).toBe(true);
		expect(
			validateInvoiceDiscounts({
				user: user("manager"),
				settings: caps(),
				discountPct: 5,
				writeoffCents: 0,
				action: "approve",
			}).ok,
		).toBe(true);
	});

	it("parses discount form dollars", () => {
		const ok = parseInvoiceDiscountForm({
			discount_pct: "7.5",
			writeoff_dollars: "12.50",
			notes: " promo ",
		});
		expect(ok).toEqual({
			ok: true,
			discountPct: 7.5,
			writeoffCents: 1250,
			notes: "promo",
		});
		expect(parseInvoiceDiscountForm({ discount_pct: "101" }).ok).toBe(false);
	});
});
