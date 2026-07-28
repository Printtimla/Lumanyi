import { describe, expect, it } from "vitest";
import {
	canManagePriceLists,
	dollarsToCents,
	isPriceListProduct,
	parsePriceListForm,
} from "../src/lib/price-list";
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

describe("SA-6.1 price lists", () => {
	it("only owner manages price lists", () => {
		expect(canManagePriceLists(user("owner"))).toBe(true);
		expect(canManagePriceLists(user("dispatcher"))).toBe(false);
		expect(canManagePriceLists(user("tech"))).toBe(false);
	});

	it("parses dollars to cents", () => {
		expect(dollarsToCents("12.50")).toBe(1250);
		expect(dollarsToCents("-1")).toBeNull();
		expect(dollarsToCents("")).toBeNull();
	});

	it("validates create/update form", () => {
		expect(isPriceListProduct("restoration")).toBe(true);
		expect(isPriceListProduct("print")).toBe(false);
		const ok = parsePriceListForm({
			product: "floors",
			category: "labor",
			name: "Hardwood deep clean",
			unit: "sqft",
			unit_dollars: "0.45",
			sort_order: "10",
		});
		expect(ok.ok).toBe(true);
		if (ok.ok) {
			expect(ok.unitCents).toBe(45);
			expect(ok.product).toBe("floors");
		}
		expect(
			parsePriceListForm({
				product: "print",
				category: "labor",
				name: "x",
				unit_dollars: "1",
			}).ok,
		).toBe(false);
	});
});
