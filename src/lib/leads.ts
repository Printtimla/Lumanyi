/** Lead pipeline helpers for field jobs (lead / estimate). */

export const LEAD_SOURCES = [
	{ value: "referral", label: "Referral" },
	{ value: "insurer", label: "Insurer / adjuster" },
	{ value: "web", label: "Web / form" },
	{ value: "walk_in", label: "Walk-in" },
	{ value: "phone", label: "Phone" },
	{ value: "other", label: "Other" },
] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number]["value"];

export const LEAD_PIPELINE_STATUSES = ["lead", "estimate"] as const;

export function leadSourceLabel(value: string | null | undefined): string {
	if (!value) return "—";
	const hit = LEAD_SOURCES.find((s) => s.value === value);
	return hit?.label ?? value.replace(/_/g, " ");
}

export function isValidLeadSource(value: string): value is LeadSource {
	return LEAD_SOURCES.some((s) => s.value === value);
}

export function normalizeLeadSource(value: string): LeadSource | null {
	const v = value.trim();
	if (!v) return null;
	return isValidLeadSource(v) ? v : "other";
}

/** YYYY-MM-DD for date inputs; empty if unset. */
export function followUpDateValue(iso: string | null | undefined): string {
	if (!iso) return "";
	return iso.slice(0, 10);
}

export function isFollowUpOverdue(
	followUpAt: string | null | undefined,
	today = new Date().toISOString().slice(0, 10),
): boolean {
	if (!followUpAt) return false;
	return followUpAt.slice(0, 10) < today;
}
