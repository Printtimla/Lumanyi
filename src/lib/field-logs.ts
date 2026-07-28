/** Moisture + equipment log helpers for restoration jobs. */

export const EQUIPMENT_TYPES = [
	{ value: "air_mover", label: "Air mover" },
	{ value: "dehumidifier", label: "Dehumidifier" },
	{ value: "hepa_scrubber", label: "HEPA air scrubber" },
	{ value: "injectidry", label: "Injectidry / specialty drying" },
	{ value: "other", label: "Other" },
] as const;

export function equipmentTypeLabel(value: string | null | undefined): string {
	if (!value) return "—";
	return (
		EQUIPMENT_TYPES.find((t) => t.value === value)?.label ??
		value.replace(/_/g, " ")
	);
}

export type FieldLogRow = {
	id: string;
	kind: "moisture" | "equipment";
	logged_at: string;
	area: string | null;
	reading: string | null;
	temp_f: number | null;
	rh_pct: number | null;
	grains: number | null;
	equipment_type: string | null;
	equipment_count: number | null;
	notes: string | null;
	created_at: string;
	user_name: string | null;
};
