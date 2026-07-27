export const PRINT_PRODUCT_TYPES = [
	{ value: "flyer", label: "Flyer" },
	{ value: "brochure", label: "Brochure" },
	{ value: "postcard", label: "Postcard" },
	{ value: "banner", label: "Banner" },
	{ value: "business_card", label: "Business card" },
	{ value: "menu", label: "Menu" },
	{ value: "other", label: "Other" },
] as const;

export const PRINT_STATUSES = [
	{ value: "intake", label: "Intake" },
	{ value: "proof", label: "Proof" },
	{ value: "approved", label: "Approved" },
	{ value: "in_production", label: "In production" },
	{ value: "ready", label: "Ready" },
	{ value: "delivered", label: "Delivered" },
	{ value: "cancelled", label: "Cancelled" },
] as const;

export type PrintProductType = (typeof PRINT_PRODUCT_TYPES)[number]["value"];
export type PrintStatus = (typeof PRINT_STATUSES)[number]["value"];

export function printProductLabel(value: string): string {
	return PRINT_PRODUCT_TYPES.find((p) => p.value === value)?.label ?? value;
}

export function printStatusLabel(value: string): string {
	return PRINT_STATUSES.find((s) => s.value === value)?.label ?? value.replace(/_/g, " ");
}
