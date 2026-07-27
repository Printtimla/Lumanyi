/** Default checklist templates by field job type. */

import type { FieldJobType } from "./products";

const WATER_BASE = [
	"Document date of loss / claim notes",
	"Photo inventory of affected areas",
	"Customer walkthrough / sign-off",
];

export const CHECKLISTS: Record<FieldJobType, string[]> = {
	restoration: [
		...WATER_BASE,
		"Moisture readings logged",
		"Equipment placed / extraction started",
	],
	water_restoration: [
		...WATER_BASE,
		"Category / class of water documented",
		"Moisture readings logged",
		"Extraction / equipment placed",
	],
	structural_drying: [
		...WATER_BASE,
		"Psychrometric / drying goals set",
		"Equipment placement mapped",
		"Daily moisture readings logged",
	],
	microbial_remediation: [
		"Scope / containment plan reviewed",
		"PPE and containment in place",
		"Affected materials removed / cleaned per protocol",
		"Photo documentation complete",
		"Customer walkthrough / sign-off",
	],
	biohazard: [
		"Scene assessment / hazards noted",
		"PPE and disposal plan confirmed",
		"Affected materials cleaned or removed per protocol",
		"Disinfection complete",
		"Photo documentation + sign-off",
	],
	odor_removal: [
		"Odor source identified / documented",
		"Treatment method selected",
		"Treatment applied",
		"Re-check odor / customer walkthrough",
	],
	hard_floor: [
		"Confirm floor type and sq ft",
		"Move furniture / protect edges",
		"Clean / scrub pass complete",
		"Dry / finish pass complete",
		"Customer walkthrough / sign-off",
	],
};

export function checklistFor(type: string): string[] {
	if (type in CHECKLISTS) {
		return CHECKLISTS[type as FieldJobType];
	}
	return CHECKLISTS.water_restoration;
}
