/** Product shells + IICRC-aligned restoration service types. */

export const RESTORATION_TYPES = [
	{ value: "water_restoration", label: "Water damage restoration" },
	{ value: "structural_drying", label: "Structural drying" },
	{ value: "microbial_remediation", label: "Microbial remediation" },
	{ value: "biohazard", label: "Bio-hazard / trauma & crime scene cleaning" },
	{ value: "odor_removal", label: "Odor removal" },
] as const;

export const FLOOR_TYPES = [
	{ value: "hard_floor", label: "Hard floor cleaning" },
] as const;

export type RestorationJobType = (typeof RESTORATION_TYPES)[number]["value"];
export type FloorJobType = (typeof FLOOR_TYPES)[number]["value"];
export type FieldJobType = RestorationJobType | FloorJobType | "restoration";

export type ProductKey = "restoration" | "floors" | "print";

export const PRODUCTS: Array<{
	key: ProductKey;
	title: string;
	blurb: string;
	href: string;
}> = [
	{
		key: "restoration",
		title: "Restoration & Remediation",
		blurb:
			"Water restoration, structural drying, microbial remediation, bio-hazard cleanup, odor removal.",
		href: "/restoration",
	},
	{
		key: "floors",
		title: "Hard Floor Cleaning",
		blurb: "Commercial hard-floor cleaning, recurring contracts, and crew schedules.",
		href: "/floors",
	},
	{
		key: "print",
		title: "Print Ops",
		blurb: "Print jobs, proofs, press board, files, and quotes.",
		href: "/print",
	},
];

const ALL_FIELD = [...RESTORATION_TYPES, ...FLOOR_TYPES] as const;

export function jobTypeLabel(type: string): string {
	if (type === "restoration") return "Water damage restoration";
	const hit = ALL_FIELD.find((t) => t.value === type);
	return hit?.label ?? type.replace(/_/g, " ");
}

export function isRestorationType(type: string): boolean {
	return (
		type === "restoration" ||
		RESTORATION_TYPES.some((t) => t.value === type)
	);
}

export function isFloorType(type: string): boolean {
	return type === "hard_floor";
}

export function productForJobType(type: string): "restoration" | "floors" {
	return isFloorType(type) ? "floors" : "restoration";
}

export function isValidFieldJobType(type: string): type is FieldJobType {
	return (
		type === "restoration" ||
		ALL_FIELD.some((t) => t.value === type)
	);
}

export function normalizeJobType(type: string): FieldJobType {
	if (type === "restoration") return "water_restoration";
	if (isValidFieldJobType(type)) return type;
	return "water_restoration";
}
