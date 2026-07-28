/** Default checklist templates by field job type. */

import type { FieldJobType } from "./products";

const WATER_BASE = [
	"Document date of loss / claim notes",
	"Photo inventory of affected areas",
	"Customer walkthrough / sign-off",
];

const FLOOR_BASE = [
	"Confirm floor type and sq ft",
	"Move furniture / protect edges",
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
	strip_wax: [
		...FLOOR_BASE,
		"Full strip of old finish complete",
		"Multi-coat refinish applied / dry",
	],
	floor_waxing: [
		...FLOOR_BASE,
		"Finish coats applied",
		"Dry / gloss check complete",
	],
	scrub_recoat: [
		...FLOOR_BASE,
		"Scrub / interim pass complete",
		"Recoat applied / dry",
	],
	burnishing: [
		...FLOOR_BASE,
		"Burnish / buff pass complete",
		"Wet-look gloss verified",
	],
	floor_sealing: [
		...FLOOR_BASE,
		"Sealer matched to substrate",
		"Sealer applied / cure checked",
	],
	epoxy: [
		...FLOOR_BASE,
		"Surface prep complete",
		"Epoxy system applied",
		"Cure time / traffic release confirmed",
	],
	tile_grout: [
		...FLOOR_BASE,
		"Tile & grout clean / restore complete",
		"Grout sealed if in scope",
	],
	concrete: [
		...FLOOR_BASE,
		"Soil / marks removed",
		"Seal or epoxy prep complete if in scope",
	],
	hardwood: [
		...FLOOR_BASE,
		"Wood-safe chemistry used",
		"Finish / wax step complete if in scope",
	],
	laminate: [
		...FLOOR_BASE,
		"Moisture-safe clean complete",
		"Edges checked for swell risk",
	],
	vinyl_linoleum: [
		...FLOOR_BASE,
		"Clean / scrub pass complete",
		"Finish / recoat if in scope",
	],
	pet_odor_removal: [
		"Affected area / sq ft documented",
		"Enzyme / treatment applied",
		"Subfloor seal if in scope",
		"Odor re-check / customer walkthrough",
	],
	hard_floor: [
		...FLOOR_BASE,
		"Clean / scrub pass complete",
		"Dry / finish pass complete",
	],
};

export function checklistFor(type: string): string[] {
	if (type in CHECKLISTS) {
		return CHECKLISTS[type as FieldJobType];
	}
	return CHECKLISTS.water_restoration;
}
