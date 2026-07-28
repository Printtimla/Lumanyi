/** User role / employee designation helpers. */

export const USER_ROLES = [
	{ value: "owner", label: "Owner" },
	{ value: "dispatcher", label: "Dispatcher" },
	{ value: "lead_tech", label: "Lead Tech" },
	{ value: "tech", label: "Tech" },
] as const;

export type UserRole = (typeof USER_ROLES)[number]["value"];

export function roleLabel(role: string): string {
	return USER_ROLES.find((r) => r.value === role)?.label ?? role.replace(/_/g, " ");
}

export function isValidUserRole(role: string): role is UserRole {
	return USER_ROLES.some((r) => r.value === role);
}

/** Format for Assigned to dropdowns. */
export function assigneeOptionLabel(name: string, role: string): string {
	return `${name} · ${roleLabel(role)}`;
}
