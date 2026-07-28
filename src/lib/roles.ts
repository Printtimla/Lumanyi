/** User permission roles + employee designations (blueprint-aligned). */

import type { ProductKey } from "./products";
import { ALL_PRODUCTS } from "./access";

/** Login / permission roles (DB CHECK on users.role). */
export const PERMISSION_ROLES = [
	{ value: "owner", label: "Owner" },
	{ value: "dispatcher", label: "Dispatcher" },
	{ value: "tech", label: "Tech" },
] as const;

/**
 * Designations shown in Users admin + Assigned to.
 * Management maps to dispatcher permission until a real manager role ships.
 */
export const USER_ROLES = [
	{ value: "owner", label: "Super Admin / Owner" },
	{ value: "manager", label: "Management / Admin" },
	{ value: "dispatcher", label: "Dispatch / Operations" },
	{ value: "mitigation_lead_tech", label: "Mitigation Lead Tech" },
	{ value: "mitigation_tech", label: "Mitigation Tech" },
	{ value: "floor_lead_tech", label: "Floor Lead Tech" },
	{ value: "floor_tech", label: "Floor Tech" },
	{ value: "print_tech", label: "Print Tech" },
] as const;

/** Least privilege when designation omitted / forgotten. */
export const LEAST_PRIVILEGE_DESIGNATION = "mitigation_tech" as const;

/** Max concurrent active Super Admin / Owner accounts (SA-0). */
export const SUPER_ADMIN_SEAT_LIMIT = 2;

/** Legacy designation values still present on older user rows. */
export const LEGACY_DESIGNATIONS = [
	{ value: "lead_tech", label: "Lead Tech (legacy)" },
	{ value: "tech", label: "Tech (legacy)" },
] as const;

export type PermissionRole = (typeof PERMISSION_ROLES)[number]["value"];
export type UserRole = (typeof USER_ROLES)[number]["value"];
export type LegacyDesignation = (typeof LEGACY_DESIGNATIONS)[number]["value"];
export type AnyDesignation = UserRole | LegacyDesignation;

export type SeatBucket = "super_admin" | "management" | "dispatch";

const ALL_LABELS: Array<{ value: string; label: string }> = [
	...USER_ROLES,
	...LEGACY_DESIGNATIONS,
];

export function roleLabel(role: string): string {
	return (
		ALL_LABELS.find((r) => r.value === role)?.label ??
		role.replace(/_/g, " ")
	);
}

export function isValidUserRole(role: string): role is UserRole {
	return USER_ROLES.some((r) => r.value === role);
}

export function isKnownDesignation(role: string): role is AnyDesignation {
	return ALL_LABELS.some((r) => r.value === role);
}

/** Map designation → permission role stored in users.role. */
export function permissionRoleFor(
	designation: string,
): PermissionRole {
	if (designation === "owner") return "owner";
	if (designation === "manager" || designation === "dispatcher") {
		return "dispatcher";
	}
	return "tech"; // all tech lanes + legacy lead_tech / tech
}

export function defaultProductsForDesignation(
	designation: string,
): ProductKey[] {
	switch (designation) {
		case "owner":
		case "manager":
		case "dispatcher":
			return [...ALL_PRODUCTS];
		case "mitigation_lead_tech":
		case "mitigation_tech":
		case "lead_tech":
			return ["restoration"];
		case "floor_lead_tech":
		case "floor_tech":
			return ["floors"];
		case "print_tech":
			return ["print"];
		case "tech":
			return [...ALL_PRODUCTS];
		default:
			return [...ALL_PRODUCTS];
	}
}

export function seatBucketForDesignation(
	designation: string,
): SeatBucket | null {
	if (designation === "owner") return "super_admin";
	if (designation === "manager") return "management";
	if (designation === "dispatcher") return "dispatch";
	return null;
}

export function seatLimitForBucket(bucket: SeatBucket): number {
	if (bucket === "super_admin") return SUPER_ADMIN_SEAT_LIMIT;
	if (bucket === "management") return 4;
	return 3; // dispatch
}

export function seatLimitForDesignation(designation: string): number | null {
	const bucket = seatBucketForDesignation(designation);
	if (!bucket) return null;
	return seatLimitForBucket(bucket);
}

export function seatBucketLabel(bucket: SeatBucket): string {
	if (bucket === "super_admin") return "Super Admin / Owner";
	if (bucket === "management") return "Management / Admin";
	return "Dispatch / Operations";
}

/** SQL-friendly list of designations that count toward a seat bucket. */
export function designationsInSeatBucket(bucket: SeatBucket): string[] {
	if (bucket === "super_admin") return ["owner"];
	if (bucket === "management") return ["manager"];
	return ["dispatcher"];
}

/** Format for Assigned to dropdowns. */
export function assigneeOptionLabel(name: string, designation: string): string {
	return `${name} · ${roleLabel(designation)}`;
}
