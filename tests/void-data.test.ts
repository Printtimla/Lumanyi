import { describe, expect, it } from "vitest";
import {
	canSetAssetStatusWithOpenAssignment,
	canVoidClaimData,
	normalizeVoidReason,
} from "../src/lib/void-data";
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

describe("SA-3 void claim data", () => {
	it("field roles may void", () => {
		expect(canVoidClaimData(user("owner"))).toBe(true);
		expect(canVoidClaimData(user("dispatcher"))).toBe(true);
		expect(canVoidClaimData(user("tech"))).toBe(true);
	});

	it("requires a short non-empty reason", () => {
		expect(normalizeVoidReason("")).toBeNull();
		expect(normalizeVoidReason("ab")).toBeNull();
		expect(normalizeVoidReason("  typo  ")).toBe("typo");
		expect(normalizeVoidReason("wrong room")).toBe("wrong room");
	});

	it("blocks status change off on_job while assignment open", () => {
		expect(canSetAssetStatusWithOpenAssignment("retired", true)).toBe(false);
		expect(canSetAssetStatusWithOpenAssignment("available", true)).toBe(false);
		expect(canSetAssetStatusWithOpenAssignment("on_job", true)).toBe(true);
		expect(canSetAssetStatusWithOpenAssignment("retired", false)).toBe(true);
	});
});
