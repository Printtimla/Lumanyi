import { describe, expect, it } from "vitest";
import { canAccessTrash, canSoftDelete } from "../src/lib/soft-delete";
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

describe("SA-2 soft delete access", () => {
	it("only owner opens trash", () => {
		expect(canAccessTrash(user("owner"))).toBe(true);
		expect(canAccessTrash(user("manager"))).toBe(false);
		expect(canAccessTrash(user("dispatcher"))).toBe(false);
		expect(canAccessTrash(user("tech"))).toBe(false);
	});

	it("owner, manager, and dispatcher may archive", () => {
		expect(canSoftDelete(user("owner"))).toBe(true);
		expect(canSoftDelete(user("manager"))).toBe(true);
		expect(canSoftDelete(user("dispatcher"))).toBe(true);
		expect(canSoftDelete(user("tech"))).toBe(false);
	});
});
