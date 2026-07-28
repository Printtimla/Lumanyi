/** User permission roles + employee designations. */

/** Login / permission roles (DB CHECK on users.role). */
export const PERMISSION_ROLES = [
	{ value: "owner", label: "Owner" },
	{ value: "dispatcher", label: "Dispatcher" },
	{ value: "tech", label: "Tech" },
] as const;

/** Field designations shown in Assigned to / Users admin. */
export const USER_ROLES = [
	{ value: "owner", label: "Owner" },
	{ value: "dispatcher", label: "Dispatcher" },
	{ value: "lead_tech", label: "Lead Tech" },
	{ value: "tech", label: "Tech" },
] as const;

export type PermissionRole = (typeof PERMISSION_ROLES)[number]["value"];
export type UserRole = (typeof USER_ROLES)[number]["value"];

export function roleLabel(role: string): string {
	return USER_ROLES.find((r) => r.value === role)?.label ?? role.replace(/_/g, " ");
}

export function isValidUserRole(role: string): role is UserRole {
	return USER_ROLES.some((r) => r.value === role);
}

/** Map designation → permission role stored in users.role. */
export function permissionRoleFor(designation: UserRole): PermissionRole {
	if (designation === "owner") return "owner";
	if (designation === "dispatcher") return "dispatcher";
	return "tech"; // tech + lead_tech
}

/** Format for Assigned to dropdowns. */
export function assigneeOptionLabel(name: string, designation: string): string {
	return `${name} · ${roleLabel(designation)}`;
}
