import { describe, expect, it } from "vitest";
import {
	canManageLaborRates,
	laborCostPrefill,
	parseLaborRateForm,
} from "../src/lib/labor-rates";
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

describe("SA-6.3 labor rates", () => {
	it("only owner manages labor rates", () => {
		expect(canManageLaborRates(user("owner"))).toBe(true);
		expect(canManageLaborRates(user("dispatcher"))).toBe(false);
		expect(canManageLaborRates(user("tech"))).toBe(false);
	});

	it("parses rate form", () => {
		const ok = parseLaborRateForm({
			designation: "mitigation_tech",
			hourly_dollars: "45.50",
			active: "1",
		});
		expect(ok.ok).toBe(true);
		if (ok.ok) {
			expect(ok.hourly_cents).toBe(4550);
			expect(ok.designation).toBe("mitigation_tech");
		}
		expect(
			parseLaborRateForm({
				designation: "not_a_role",
				hourly_dollars: "10",
			}).ok,
		).toBe(false);
	});

	it("builds cost prefill from designation rate", () => {
		const prefill = laborCostPrefill("floor_tech", 4200);
		expect(prefill.category).toBe("labor");
		expect(prefill.unit).toBe("hr");
		expect(prefill.unit_dollars).toBe("42.00");
		expect(prefill.description).toContain("Floor Tech");
	});
});
