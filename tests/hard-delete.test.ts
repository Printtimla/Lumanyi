import { describe, expect, it } from "vitest";
import {
	canHardDelete,
	verifyOwnerPasswordForHardDelete,
} from "../src/lib/hard-delete";
import { hashPassword } from "../src/lib/password";
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

describe("SA-4 hard delete access", () => {
	it("only owner may hard-delete", () => {
		expect(canHardDelete(user("owner"))).toBe(true);
		expect(canHardDelete(user("dispatcher"))).toBe(false);
		expect(canHardDelete(user("tech"))).toBe(false);
	});

	it("requires correct owner password", async () => {
		const hash = await hashPassword("CorrectHorse1!");
		expect(await verifyOwnerPasswordForHardDelete("", hash)).toBe(false);
		expect(await verifyOwnerPasswordForHardDelete("wrong", hash)).toBe(false);
		expect(await verifyOwnerPasswordForHardDelete("CorrectHorse1!", hash)).toBe(
			true,
		);
	});
});
