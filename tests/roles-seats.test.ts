import { describe, expect, it } from "vitest";
import {
	defaultProductsForDesignation,
	LEAST_PRIVILEGE_DESIGNATION,
	permissionRoleFor,
	roleLabel,
	seatLimitForDesignation,
	SUPER_ADMIN_SEAT_LIMIT,
} from "../src/lib/roles";

describe("SA-0 Super Admin seats", () => {
	it("limits owner designation to 2 seats", () => {
		expect(SUPER_ADMIN_SEAT_LIMIT).toBe(2);
		expect(seatLimitForDesignation("owner")).toBe(2);
	});

	it("does not seat-cap tech lanes", () => {
		expect(seatLimitForDesignation("mitigation_tech")).toBeNull();
		expect(seatLimitForDesignation("print_tech")).toBeNull();
	});
});

describe("SA-1 designation mapping", () => {
	it("maps Super Admin designation to owner permission", () => {
		expect(permissionRoleFor("owner")).toBe("owner");
		expect(roleLabel("owner")).toBe("Super Admin / Owner");
	});

	it("maps management to dispatcher permission until real manager ships", () => {
		expect(permissionRoleFor("manager")).toBe("dispatcher");
	});

	it("defaults least privilege to mitigation tech + restoration", () => {
		expect(LEAST_PRIVILEGE_DESIGNATION).toBe("mitigation_tech");
		expect(permissionRoleFor(LEAST_PRIVILEGE_DESIGNATION)).toBe("tech");
		expect(defaultProductsForDesignation(LEAST_PRIVILEGE_DESIGNATION)).toEqual([
			"restoration",
		]);
	});

	it("keeps legacy lead_tech as tech permission", () => {
		expect(permissionRoleFor("lead_tech")).toBe("tech");
		expect(roleLabel("lead_tech")).toContain("Lead Tech");
	});
});
