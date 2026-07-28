/** Product shells + service types synced from Timla public sites. */

/** Restoration — IICRC-aligned (third marketing site not built yet). */
export const RESTORATION_TYPES = [
	{ value: "water_restoration", label: "Water damage restoration" },
	{ value: "structural_drying", label: "Structural drying" },
	{ value: "microbial_remediation", label: "Microbial remediation" },
	{
		value: "biohazard",
		label: "Biohazard / Trauma & crime scene cleaning",
	},
	{ value: "odor_removal", label: "Odor removal" },
] as const;

/**
 * Floors — core process / surface types from timlafloorrestoration.com
 * (not every vertical page). Legacy `hard_floor` kept for existing rows.
 */
export const FLOOR_TYPES = [
	{ value: "strip_wax", label: "Strip & Wax" },
	{ value: "floor_waxing", label: "Floor Waxing" },
	{ value: "scrub_recoat", label: "Scrub & Recoat / Interim" },
	{ value: "burnishing", label: "Burnishing & Buffing" },
	{ value: "floor_sealing", label: "Floor Sealing" },
	{ value: "epoxy", label: "Epoxy Floor Systems" },
	{ value: "tile_grout", label: "Tile & Grout" },
	{ value: "concrete", label: "Concrete" },
	{ value: "hardwood", label: "Hardwood" },
	{ value: "laminate", label: "Laminate" },
	{ value: "vinyl_linoleum", label: "Vinyl / Linoleum" },
	{ value: "pet_odor_removal", label: "Pet odor removal" },
	{ value: "hard_floor", label: "Hard floor (general)" },
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
	siteHint?: string;
}> = [
	{
		key: "restoration",
		title: "Restoration & Remediation",
		blurb:
			"Water restoration, structural drying, microbial remediation, biohazard cleanup, odor removal.",
		href: "/restoration",
		siteHint: "Marketing site TBD",
	},
	{
		key: "floors",
		title: "Hard Floor Cleaning",
		blurb:
			"Strip & wax, scrub & recoat, burnishing, sealing, epoxy, tile & grout — from timlafloorrestoration.com.",
		href: "/floors",
		siteHint: "timlafloorrestoration.com",
	},
	{
		key: "print",
		title: "Print Ops",
		blurb:
			"Print, finishing, and mail prep — catalog types from sacramentob2bprint.com.",
		href: "/print",
		siteHint: "sacramentob2bprint.com",
	},
];

const ALL_FIELD = [...RESTORATION_TYPES, ...FLOOR_TYPES] as const;

export const FLOOR_TYPE_VALUES = FLOOR_TYPES.map((t) => t.value);

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
	return FLOOR_TYPES.some((t) => t.value === type);
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
