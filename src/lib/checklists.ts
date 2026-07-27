/** Default checklist templates by job type (Release 1). */

export const CHECKLISTS: Record<"restoration" | "hard_floor", string[]> = {
	restoration: [
		"Document date of loss / claim notes",
		"Photo inventory of affected areas",
		"Moisture readings logged",
		"Equipment placed / extraction started",
		"Customer walkthrough / sign-off",
	],
	hard_floor: [
		"Confirm floor type and sq ft",
		"Move furniture / protect edges",
		"Clean / scrub pass complete",
		"Dry / finish pass complete",
		"Customer walkthrough / sign-off",
	],
};
