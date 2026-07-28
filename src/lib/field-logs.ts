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
	voided_at: string | null;
	void_reason: string | null;
};

/**
 * Approximate grains per pound (GPP) from dry-bulb °F and RH % at sea level.
 * Magnus saturation vapor pressure + humidity ratio (standard psychrometric approx).
 * Helper only — not a certification of IICRC S500 compliance.
 */
export function grainsPerPoundFromTempRh(
	tempF: number,
	rhPct: number,
): number | null {
	if (!Number.isFinite(tempF) || !Number.isFinite(rhPct)) return null;
	if (rhPct < 0 || rhPct > 100) return null;
	const tempC = (tempF - 32) * (5 / 9);
	const pws =
		0.61094 * Math.exp((17.625 * tempC) / (tempC + 243.04)); // kPa
	const pw = pws * (rhPct / 100);
	const pAtm = 101.325; // kPa sea level
	if (pw >= pAtm) return null;
	const w = (0.621945 * pw) / (pAtm - pw); // lb/lb
	const gpp = w * 7000;
	if (!Number.isFinite(gpp) || gpp < 0) return null;
	return Math.round(gpp * 10) / 10;
}

/** Prefer explicit grains; otherwise derive from temp + RH when both present. */
export function resolveGrains(
	tempF: number | null,
	rhPct: number | null,
	grains: number | null,
): number | null {
	if (grains != null) return grains;
	if (tempF == null || rhPct == null) return null;
	return grainsPerPoundFromTempRh(tempF, rhPct);
}
