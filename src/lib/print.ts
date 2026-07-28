/**
 * Print product types from sacramentob2bprint.com
 * (`print-adrian` data/services.yml titles + slugs).
 * Legacy short codes kept for existing print_jobs rows.
 */

export const PRINT_PRODUCT_TYPES = [
	// Reach Customers & Mail
	{
		value: "automated_paper_folding",
		label: "High-Volume Folding & Document Creasing Capacity",
	},
	{
		value: "billing_invoices_compliance_mailing",
		label: "Billing Invoices & Compliance Mailing Services",
	},
	{
		value: "mass_direct_mail_postcards",
		label: "Postcard Printing & Direct Mail",
	},
	{
		value: "political_campaign_mailers",
		label: "Political Campaign Mailer Printing & Delivery",
	},
	{
		value: "print_and_fold_packages",
		label: "Brochure Printing, Folding & Mail Prep",
	},
	// Work Documents & Manuals
	{
		value: "b2b_print_fulfillment",
		label: "B2B Print Fulfillment Contracts & Statement Processing",
	},
	{
		value: "bulk_document_printing",
		label: "Bulk Business Document Printing & Copying",
	},
	{
		value: "wire_plastic_comb_bookbinding",
		label: "Wire & Plastic Comb Bookbinding",
	},
	{
		value: "legal_discovery_printing",
		label: "Small-Batch Legal Printing & Exhibit Prep",
	},
	{ value: "business_reports", label: "Business Reports" },
	{ value: "manuals_training_kits", label: "Manuals & Training Kits" },
	{ value: "bulk_scan_to_pdf", label: "Legal & Small-Batch Scan-to-PDF" },
	{ value: "brochure_printing", label: "Brochure Printing & Folding" },
	{ value: "flyer_printing", label: "Flyer & Handbill Printing" },
	// On-Site Signs & Displays
	{
		value: "architectural_blueprints",
		label: "Architectural Blueprints & Construction Plan Copies",
	},
	{
		value: "die_cut_vinyl_decals",
		label: "Custom Die-Cut Vinyl Decals & Solid Cast Lettering",
	},
	{
		value: "commercial_signs_banners",
		label: "Vinyl Banners & Outdoor Signage",
	},
	{ value: "tripod_x_frame_banners", label: "X-Frame Banner Stands" },
	{
		value: "window_graphics_privacy_frost",
		label: "Storefront Window Graphic Cutting & Office Privacy Frost",
	},
	{
		value: "wide_format_posters",
		label: "Wide-Format Poster Prints & Presentation Graphics",
	},
	{
		value: "event_banners_backdrops",
		label: "Event Banners & Fabric Backdrops",
	},
	{
		value: "rigid_signs_boards",
		label: "Rigid Signs, Boards & Business Signs",
	},
	// Protect & Finish Materials
	{
		value: "compliance_healthcare_lamination",
		label: "Compliance & Healthcare Lamination",
	},
	{
		value: "restaurant_menu_lamination",
		label: "Durable Restaurant Menu Lamination",
	},
	{
		value: "lamination_wide_format_finishing",
		label: "Lamination & Wide-Format Finishing",
	},
	// Invites, Thanks & Cards
	{
		value: "custom_invitations_announcements",
		label: "Custom Invitations & Announcements",
	},
	{
		value: "branded_thank_you_cards",
		label: "Greeting, Holiday & Thank You Cards",
	},
	{
		value: "presentation_portfolio_binding",
		label: "Presentation Portfolio Binding & Pitch Decks",
	},
	{ value: "restaurant_menu_printing", label: "Restaurant Menu Printing" },
	// Legacy short codes (pre-catalog import)
	{ value: "flyer", label: "Flyer (legacy)" },
	{ value: "brochure", label: "Brochure (legacy)" },
	{ value: "postcard", label: "Postcard (legacy)" },
	{ value: "banner", label: "Banner (legacy)" },
	{ value: "business_card", label: "Business card (legacy)" },
	{ value: "menu", label: "Menu (legacy)" },
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

/** Columns shown on the press / production board. */
export const PRINT_BOARD_COLUMNS = [
	"intake",
	"proof",
	"approved",
	"in_production",
	"ready",
] as const;

export const PRINT_FILE_KINDS = [
	{ value: "artwork", label: "Artwork" },
	{ value: "proof", label: "Proof" },
	{ value: "other", label: "Other" },
] as const;

export const PRINT_LEGACY_TYPES = new Set([
	"flyer",
	"brochure",
	"postcard",
	"banner",
	"business_card",
	"menu",
]);

/** Catalog types for new-job dropdowns (exclude legacy short codes except Other). */
export function printTypesForSelect(current?: string) {
	return PRINT_PRODUCT_TYPES.filter(
		(p) =>
			p.value === "other" ||
			!PRINT_LEGACY_TYPES.has(p.value) ||
			p.value === current,
	);
}

export function printProductLabel(value: string): string {
	return PRINT_PRODUCT_TYPES.find((p) => p.value === value)?.label ?? value;
}

export function printStatusLabel(value: string): string {
	return (
		PRINT_STATUSES.find((s) => s.value === value)?.label ??
		value.replace(/_/g, " ")
	);
}

export async function syncPrintQuoteTotal(
	db: D1Database,
	printJobId: string,
): Promise<number> {
	const row = await db
		.prepare(
			`SELECT COALESCE(SUM(quantity * unit_cents), 0) AS total
       FROM print_quote_lines WHERE print_job_id = ?`,
		)
		.bind(printJobId)
		.first<{ total: number }>();
	const total = Math.round(row?.total ?? 0);
	await db
		.prepare(
			`UPDATE print_jobs SET estimate_cents = ?, updated_at = datetime('now') WHERE id = ?`,
		)
		.bind(total, printJobId)
		.run();
	return total;
}
