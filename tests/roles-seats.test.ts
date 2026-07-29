import { describe, expect, it } from "vitest";
import {
	defaultProductsForDesignation,
	dbRoleForStorage,
	LEAST_PRIVILEGE_DESIGNATION,
	permissionRoleFor,
	resolvePermissionRole,
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

	it("maps management to manager permission (MG-0)", () => {
		expect(permissionRoleFor("manager")).toBe("manager");
		expect(permissionRoleFor("dispatcher")).toBe("dispatcher");
	});

	it("stores manager as dispatcher for DB CHECK safety", () => {
		expect(dbRoleForStorage("manager")).toBe("dispatcher");
		expect(dbRoleForStorage("dispatcher")).toBe("dispatcher");
		expect(dbRoleForStorage("owner")).toBe("owner");
		expect(dbRoleForStorage("tech")).toBe("tech");
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

	it("elevates designation=manager even when DB role is still dispatcher", () => {
		expect(resolvePermissionRole("dispatcher", "manager")).toBe("manager");
		expect(resolvePermissionRole("manager", "manager")).toBe("manager");
		expect(resolvePermissionRole("dispatcher", "dispatcher")).toBe(
			"dispatcher",
		);
	});
});
