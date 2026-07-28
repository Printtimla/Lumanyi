/** Simple equipment inventory helpers. */

import { EQUIPMENT_TYPES, equipmentTypeLabel } from "./field-logs";
import { canSetAssetStatusWithOpenAssignment } from "./void-data";

export { EQUIPMENT_TYPES, equipmentTypeLabel, canSetAssetStatusWithOpenAssignment };

export const ASSET_STATUSES = [
	{ value: "available", label: "Available" },
	{ value: "on_job", label: "On job" },
	{ value: "maintenance", label: "Maintenance" },
	{ value: "retired", label: "Retired" },
] as const;

export type AssetStatus = (typeof ASSET_STATUSES)[number]["value"];

export function assetStatusLabel(status: string): string {
	return (
		ASSET_STATUSES.find((s) => s.value === status)?.label ??
		status.replace(/_/g, " ")
	);
}

export function isValidAssetStatus(status: string): status is AssetStatus {
	return ASSET_STATUSES.some((s) => s.value === status);
}

export function isValidEquipmentType(type: string): boolean {
	return EQUIPMENT_TYPES.some((t) => t.value === type);
}

export type AssetRow = {
	id: string;
	label: string;
	equipment_type: string;
	serial: string | null;
	status: string;
	notes: string | null;
};
