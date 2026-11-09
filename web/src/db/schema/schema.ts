import { pgTable, primaryKey, unique, pgPolicy, uuid, text, boolean, timestamp, integer, numeric, jsonb, foreignKey, check, date, pgEnum, index, doublePrecision } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

// 0034 adds 'marketing' — a restricted seat that can ONLY reach /admin/seo
// (meta editing for the SEO agency); every other admin surface 403s it.
export const appRole = pgEnum("app_role", ['client', 'provider', 'clerk', 'admin', 'cleaner', 'marketing', 'trades'])
export const auditEventCategory = pgEnum("audit_event_category", ['job_lifecycle', 'verification', 'impersonation', 'pricing_override', 'strike', 'platform_setting', 'tenant_portal_access', 'account_status', 'dispute', 'billing'])
export const conditionRating = pgEnum("condition_rating", ['excellent', 'good', 'fair', 'poor', 'damaged', 'missing', 'na'])
export const furnishedStatus = pgEnum("furnished_status", ['furnished', 'unfurnished', 'part_furnished'])
export const inspectionType = pgEnum("inspection_type", ['new_inventory', 'check_in', 'check_out', 'mid_term', 'interim'])
export const itemCondition = pgEnum("item_condition", ['good', 'fair', 'poor', 'na'])
export const jobStatus = pgEnum("job_status", ['draft', 'pending', 'published', 'accepted', 'assigned', 'in_progress', 'submitted', 'reviewed', 'signed', 'completed', 'paid', 'cancelled'])
export const propertyType = pgEnum("property_type", ['studio', '1_bed', '2_bed', '3_bed', '4_bed', '5_bed', '6_bed', '7_bed', '8_bed', '9_bed'])
export const roomType = pgEnum("room_type", ['entrance', 'hallway', 'living_room', 'dining_room', 'kitchen', 'bedroom', 'bathroom', 'toilet', 'utility', 'storage', 'garden', 'garage', 'balcony', 'other'])


export const profiles = pgTable("profiles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	fullName: text("full_name"),
	companyName: text("company_name"),
	phone: text(),
	avatarUrl: text("avatar_url"),
	onboardingCompleted: boolean("onboarding_completed").default(false).notNull(),
	termsAgreedAt: timestamp("terms_agreed_at", { withTimezone: true, mode: 'string' }),
	nonCircumventionAgreedAt: timestamp("non_circumvention_agreed_at", { withTimezone: true, mode: 'string' }),
	clerkJobsCompleted: integer("clerk_jobs_completed").default(0),
	clerkRating: numeric("clerk_rating").default('0'),
	clerkLevel: integer("clerk_level").default(1),
	// 0042 — negotiated portfolio rate, percent off service fees.
	portfolioPct: numeric("portfolio_pct"),
	isSuperAdmin: boolean("is_super_admin").default(false).notNull(),
	providerId: uuid("provider_id"),
	verificationDocuments: jsonb("verification_documents").default([]),
	verificationStatus: text("verification_status").default('unverified'),
	// M0 additions — onboarding & verification expansion (per LISTD_M0_Tasks.md #2).
	roleSubtype: text("role_subtype"),
	termsOfBusinessSignedAt: timestamp("terms_of_business_signed_at", { withTimezone: true, mode: 'string' }),
	// 0031 — privacy-policy consent captured at signup. `version` records which
	// policy edition the user agreed to (see lib/legal/policy.ts); `accepted_at`
	// is the moment of consent. Backfilled for pre-0031 users to created_at.
	privacyPolicyVersion: text("privacy_policy_version"),
	privacyPolicyAcceptedAt: timestamp("privacy_policy_accepted_at", { withTimezone: true, mode: 'string' }),
	coverageAreas: text("coverage_areas").array(),
	serviceTypesOffered: text("service_types_offered").array(),
	vehicleDetails: text("vehicle_details"),
	languages: text().array(),
	emergencyContactName: text("emergency_contact_name"),
	emergencyContactPhone: text("emergency_contact_phone"),
	dbsCertificateUrl: text("dbs_certificate_url"),
	dbsExpiry: date("dbs_expiry"),
	qualification: text(),
	insuranceDetails: text("insurance_details"),
	insuranceExpiry: date("insurance_expiry"),
	// M1 #5–6 — additional clerk verification surface (per LISTD_M1_Tasks.md).
	governmentIdUrl: text("government_id_url"),
	governmentIdExpiry: date("government_id_expiry"),
	verificationReviewedAt: timestamp("verification_reviewed_at", { withTimezone: true, mode: 'string' }),
	verificationReviewedBy: uuid("verification_reviewed_by"),
	verificationRejectionReason: text("verification_rejection_reason"),
	// Account-status surface (migration 0005). Default 'active'; transitions
	// land via /api/admin/clients/[id]/account-status which writes an
	// `account_status/account_status.changed` audit row in the same tx.
	accountStatus: text("account_status").default('active').notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	// Internal admin notes (migration 0007). Free-text scratchpad for the
	// admin client / clerk detail surfaces. Not surfaced to the user.
	adminNotes: text("admin_notes"),
	// Forces a password change on next login (migration 0010). Set to true
	// when an owner creates a worker with a server-generated temp password,
	// or when an admin manually resets a user.
	passwordMustChange: boolean("password_must_change").default(false).notNull(),
	// 0027 — Stripe Connect (Express) account state for clerk payouts.
	stripeAccountId: text("stripe_account_id"),
	stripeChargesEnabled: boolean("stripe_charges_enabled").default(false),
	stripePayoutsEnabled: boolean("stripe_payouts_enabled").default(false),
	stripeDetailsSubmitted: boolean("stripe_details_submitted").default(false),
	stripeOnboardingStatus: text("stripe_onboarding_status").default('none'),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("profiles_user_id_key").on(table.userId),
	pgPolicy("Users can view their own profile", { as: "permissive", for: "select", to: ["public"], using: sql`(auth.uid() = user_id)` }),
	pgPolicy("Users can insert their own profile", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("Users can update their own profile", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("Admins can view all profiles", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("Admins can update all profiles", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("Providers can view their clerks profiles", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("Providers can update their clerks profiles", { as: "permissive", for: "update", to: ["public"] }),
]);

export const userRoles = pgTable("user_roles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	role: appRole().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("user_roles_user_id_role_key").on(table.userId, table.role),
	pgPolicy("Users can view their own roles", { as: "permissive", for: "select", to: ["public"], using: sql`(auth.uid() = user_id)` }),
	pgPolicy("Users can insert their own role during onboarding", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("Admins can view all user roles", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("Admins can update user roles", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("Admins can delete user roles", { as: "permissive", for: "delete", to: ["public"] }),
]);

export const organisationMembers = pgTable("organisation_members", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	organisationId: uuid("organisation_id").notNull(),
	userId: uuid("user_id").notNull(),
	orgRole: text("org_role").default('staff').notNull(),
	status: text().default('active').notNull(),
	inviteToken: uuid("invite_token").defaultRandom(),
	invitedAt: timestamp("invited_at", { withTimezone: true, mode: 'string' }),
	invitedEmail: text("invited_email"),
	lastActiveAt: timestamp("last_active_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.organisationId],
			foreignColumns: [organisations.id],
			name: "organisation_members_organisation_id_fkey"
		}),
	pgPolicy("Members can view org members", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(organisation_id = get_user_org_id(auth.uid()))` }),
	pgPolicy("Owners can insert org members", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("Owners can update org members", { as: "permissive", for: "update", to: ["authenticated"] }),
	pgPolicy("Users can insert themselves as owner", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("Admins can manage all org members", { as: "permissive", for: "all", to: ["authenticated"] }),
]);

export const organisations = pgTable("organisations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	createdBy: uuid("created_by").notNull(),
	// M0 additions — organisation setup expansion (per LISTD_M0_Tasks.md #1).
	billingAddress: text("billing_address"),
	vatNumber: text("vat_number"),
	companyRegNumber: text("company_reg_number"),
	logoUrl: text("logo_url"),
	// 0032 — how a worker's posts get paid for. 'owner_link' (default): a
	// Stripe payment link is sent to the org owner(s) to publish the job.
	// 'worker_pays': the worker completes checkout themselves.
	workerPostPaymentMode: text("worker_post_payment_mode").default('owner_link').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	pgPolicy("Members can view their own organisation", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(id = get_user_org_id(auth.uid()))` }),
	pgPolicy("Clients can create organisations", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("Owners can update their organisation", { as: "permissive", for: "update", to: ["authenticated"] }),
	pgPolicy("Admins can view all organisations", { as: "permissive", for: "select", to: ["authenticated"] }),
]);

export const properties = pgTable("properties", {
	// 0042
	areaM2: integer("area_m2"),
	outbuildings: boolean().default(false).notNull(),
	outdoor: boolean().default(false).notNull(),
	id: uuid().defaultRandom().primaryKey().notNull(),
	clientId: uuid("client_id").notNull(),
	addressLine1: text("address_line_1").notNull(),
	addressLine2: text("address_line_2"),
	city: text().notNull(),
	postcode: text().notNull(),
	propertyType: propertyType("property_type").default('studio').notNull(),
	bedrooms: integer().default(0).notNull(),
	bathrooms: integer().default(1).notNull(),
	kitchens: integer().default(1).notNull(),
	livingRooms: integer("living_rooms").default(1).notNull(),
	diningAreas: integer("dining_areas").default(0).notNull(),
	utilityRooms: integer("utility_rooms").default(0).notNull(),
	storageRooms: integer("storage_rooms").default(0).notNull(),
	hallwaysStairs: integer("hallways_stairs").default(0).notNull(),
	gardens: integer().default(0).notNull(),
	communalAreas: integer("communal_areas").default(0).notNull(),
	furnishedStatus: furnishedStatus("furnished_status").default('unfurnished').notNull(),
	heavilyFurnished: boolean("heavily_furnished").default(false).notNull(),
	// 0039 — the client's photo of the property. Renders as the job-card
	// thumbnail in both apps. Private `property-photos` bucket, so the
	// stored URL is re-signed server-side before it reaches a browser.
	imageUrl: text("image_url"),
	// 0039 — flat / house / maisonette / …. `propertyType` above is the
	// bed COUNT ('2_bed'), never the kind of dwelling. Plain text (not an
	// enum) so admin-defined kinds don't need a migration — same call as
	// 0023 made for `inspection_type`.
	dwellingType: text("dwelling_type"),
	notes: text(),
	organisationId: uuid("organisation_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	pgPolicy("Clients can view their own properties", { as: "permissive", for: "select", to: ["public"], using: sql`(auth.uid() = client_id)` }),
	pgPolicy("Clients can insert their own properties", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("Clients can update their own properties", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("Clients can delete their own properties", { as: "permissive", for: "delete", to: ["public"] }),
	pgPolicy("Clerks can view properties for their jobs", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("Org members can view org properties", { as: "permissive", for: "select", to: ["authenticated"] }),
	pgPolicy("Org members can insert org properties", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("Org members can update org properties", { as: "permissive", for: "update", to: ["authenticated"] }),
]);

export const inspectionReports = pgTable("inspection_reports", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	jobId: uuid("job_id").notNull(),
	clerkId: uuid("clerk_id").notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
	submittedAt: timestamp("submitted_at", { withTimezone: true, mode: 'string' }),
	generalNotes: text("general_notes"),
	meterReadings: jsonb("meter_readings").default({}),
	keysInfo: jsonb("keys_info").default({}),
	smokeAlarmsChecked: boolean("smoke_alarms_checked").default(false),
	carbonMonoxideChecked: boolean("carbon_monoxide_checked").default(false),
	clerkSignatureUrl: text("clerk_signature_url"),
	// 0041 - one coherent report-wide narrative generated from the structured
	// inspection. JSON keeps the overall statement and the two action lists
	// together so provisional and official renders cannot drift.
	executiveSummary: jsonb("executive_summary"),
	executiveSummaryGeneratedAt: timestamp("executive_summary_generated_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.jobId],
			foreignColumns: [jobs.id],
			name: "inspection_reports_job_id_fkey"
		}),
	pgPolicy("Clerks can insert their own reports", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`(auth.uid() = clerk_id)`  }),
	pgPolicy("Clerks can update their own reports", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("Clerks can view their own reports", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("Clients can view reports for their jobs", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("Admins can view all reports", { as: "permissive", for: "select", to: ["public"] }),
]);

export const inspectionRooms = pgTable("inspection_rooms", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	reportId: uuid("report_id").notNull(),
	roomType: roomType("room_type").notNull(),
	roomName: text("room_name").notNull(),
	roomOrder: integer("room_order").default(0).notNull(),
	overallCondition: conditionRating("overall_condition"),
	notes: text(),
	completed: boolean().default(false),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.reportId],
			foreignColumns: [inspectionReports.id],
			name: "inspection_rooms_report_id_fkey"
		}),
	pgPolicy("Clerks can manage rooms in their reports", { as: "permissive", for: "all", to: ["public"], using: sql`(EXISTS ( SELECT 1
   FROM inspection_reports
  WHERE ((inspection_reports.id = inspection_rooms.report_id) AND (inspection_reports.clerk_id = auth.uid()))))` }),
	pgPolicy("Clients can view rooms for their jobs", { as: "permissive", for: "select", to: ["public"] }),
]);

export const inspectionItemsMap = pgTable("inspection_items_map", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	roomId: uuid("room_id").notNull(),
	jobId: uuid("job_id").notNull(),
	itemName: text("item_name").notNull(),
	condition: itemCondition().default('na'),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.jobId],
			foreignColumns: [jobs.id],
			name: "inspection_items_map_job_id_fkey"
		}),
	foreignKey({
			columns: [table.roomId],
			foreignColumns: [inspectionRoomsMap.id],
			name: "inspection_items_map_room_id_fkey"
		}),
	pgPolicy("Admins can manage all mapped items", { as: "permissive", for: "all", to: ["public"], using: sql`has_role(auth.uid(), 'admin'::app_role)` }),
	pgPolicy("Clerks can manage items for their jobs", { as: "permissive", for: "all", to: ["public"] }),
	pgPolicy("Clients can view items for their jobs", { as: "permissive", for: "select", to: ["public"] }),
]);

export const inspectionItems = pgTable("inspection_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	roomId: uuid("room_id").notNull(),
	itemName: text("item_name").notNull(),
	itemCategory: text("item_category"),
	itemOrder: integer("item_order").default(0).notNull(),
	description: text(),
	condition: conditionRating(),
	conditionNotes: text("condition_notes"),
	actionType: text("action_type"),
	actionComment: text("action_comment"),
	cleanliness: text(),
	cleanlinessNotes: text("cleanliness_notes"),
	quantity: integer().default(1),
	completed: boolean().default(false),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.roomId],
			foreignColumns: [inspectionRooms.id],
			name: "inspection_items_room_id_fkey"
		}),
	pgPolicy("Clerks can manage items in their reports", { as: "permissive", for: "all", to: ["public"], using: sql`(EXISTS ( SELECT 1
   FROM (inspection_rooms r
     JOIN inspection_reports ir ON ((ir.id = r.report_id)))
  WHERE ((r.id = inspection_items.room_id) AND (ir.clerk_id = auth.uid()))))` }),
	pgPolicy("Clients can view items for their jobs", { as: "permissive", for: "select", to: ["public"] }),
]);

export const inspectionPhotos = pgTable("inspection_photos", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	reportId: uuid("report_id").notNull(),
	roomId: uuid("room_id"),
	itemId: uuid("item_id"),
	photoUrl: text("photo_url").notNull(),
	caption: text(),
	takenAt: timestamp("taken_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	isMandatory: boolean("is_mandatory").default(false),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.itemId],
			foreignColumns: [inspectionItems.id],
			name: "inspection_photos_item_id_fkey"
		}),
	foreignKey({
			columns: [table.reportId],
			foreignColumns: [inspectionReports.id],
			name: "inspection_photos_report_id_fkey"
		}),
	foreignKey({
			columns: [table.roomId],
			foreignColumns: [inspectionRooms.id],
			name: "inspection_photos_room_id_fkey"
		}),
	pgPolicy("Clerks can manage photos in their reports", { as: "permissive", for: "all", to: ["public"], using: sql`(EXISTS ( SELECT 1
   FROM inspection_reports
  WHERE ((inspection_reports.id = inspection_photos.report_id) AND (inspection_reports.clerk_id = auth.uid()))))` }),
	pgPolicy("Clients can view photos for their jobs", { as: "permissive", for: "select", to: ["public"] }),
]);

export const inspectionRoomsMap = pgTable("inspection_rooms_map", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	jobId: uuid("job_id").notNull(),
	roomName: text("room_name").notNull(),
	roomOrder: integer("room_order").default(0).notNull(),
	// 0018 — clerk-flipped completion marker. Drives the capture
	// overview's "3/6 rooms done" progress + the submit-for-review gate.
	roomCompletedAt: timestamp("room_completed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.jobId],
			foreignColumns: [jobs.id],
			name: "inspection_rooms_map_job_id_fkey"
		}),
]);

// 0018 — Per-photo capture records. One row per shutter press. The
// mobile PWA generates the `clientUuid` BEFORE uploading the file so
// retries (offline queue replay or fat-finger re-shoot) are idempotent
// against the UNIQUE constraint. `photoUrl` is a Supabase storage URL
// in the private `job-photos` bucket — readers re-mint a signed URL
// per request.
export const inspectionCaptures = pgTable("inspection_captures", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	jobId: uuid("job_id").notNull(),
	roomId: uuid("room_id").notNull(),
	clientUuid: uuid("client_uuid").notNull(),
	itemName: text("item_name"),
	condition: text(),
	caption: text(),
	photoUrl: text("photo_url").notNull(),
	position: integer().default(0).notNull(),
	capturedBy: uuid("captured_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("inspection_captures_client_uuid_key").on(table.clientUuid),
	index("inspection_captures_job_idx").on(table.jobId),
	index("inspection_captures_room_idx").on(table.roomId, table.position),
	foreignKey({
		columns: [table.jobId],
		foreignColumns: [jobs.id],
		name: "inspection_captures_job_id_fkey",
	}).onDelete('cascade'),
	foreignKey({
		columns: [table.roomId],
		foreignColumns: [inspectionRoomsMap.id],
		name: "inspection_captures_room_id_fkey",
	}).onDelete('cascade'),
	check("inspection_captures_condition_check",
		sql`condition IS NULL OR condition IN ('good','fair','poor','damaged')`),
	pgPolicy("Clerks manage captures for their jobs", { as: "permissive", for: "all", to: ["authenticated"] }),
	pgPolicy("Clients read captures for their jobs", { as: "permissive", for: "select", to: ["authenticated"] }),
	pgPolicy("Admins manage all captures", { as: "permissive", for: "all", to: ["authenticated"] }),
]);

// 0039 — the mobile PWA's item-level write-up. `inspection_captures` above
// holds the PHOTOS (joined by room + item name); this holds the prose the
// clerk types against each item, so a report can be finished on the phone
// instead of only on the desktop `/inspect` form. Items with no photo are
// legitimate here (walls, ceilings) — that's why it isn't folded into
// `inspection_captures`. Rows are the pre-submit working copy;
// `inspection_rooms` / `inspection_items` remain the submitted report.
export const inspectionCaptureItems = pgTable("inspection_capture_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	jobId: uuid("job_id").notNull(),
	roomId: uuid("room_id").notNull(),
	itemName: text("item_name").notNull(),
	itemOrder: integer("item_order").default(0).notNull(),
	description: text(),
	conditionNotes: text("condition_notes"),
	/** Explicit follow-up classification captured by the mobile clerk. */
	actionType: text("action_type"),
	actionComment: text("action_comment"),
	/** Text came from the vision model, so QA can weight it differently. */
	aiDrafted: boolean("ai_drafted").default(false).notNull(),
	/** Clerk struck a template item off this room (no dishwasher here).
	 *  Soft-delete so re-seeding the template can't resurrect it. */
	removed: boolean().default(false).notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("inspection_capture_items_job_idx").on(table.jobId),
	foreignKey({
		columns: [table.jobId],
		foreignColumns: [jobs.id],
		name: "inspection_capture_items_job_id_fkey",
	}).onDelete('cascade'),
	foreignKey({
		columns: [table.roomId],
		foreignColumns: [inspectionRoomsMap.id],
		name: "inspection_capture_items_room_id_fkey",
	}).onDelete('cascade'),
	pgPolicy("Clerks manage capture items for their jobs", { as: "permissive", for: "all", to: ["authenticated"] }),
	pgPolicy("Clients read capture items for their jobs", { as: "permissive", for: "select", to: ["authenticated"] }),
	pgPolicy("Admins manage all capture items", { as: "permissive", for: "all", to: ["authenticated"] }),
]);

// 0019 — Mobile PWA telemetry (append-only health snapshots from the
// clerk app's offline queue). See 0019_clerk_telemetry.sql.
export const clerkTelemetry = pgTable("clerk_telemetry", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clerkId: uuid("clerk_id").notNull(),
	event: text().notNull(),
	payload: jsonb().default({}).notNull(),
	userAgent: text("user_agent"),
	appVersion: text("app_version"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("clerk_telemetry_clerk_created_idx").on(table.clerkId, table.createdAt),
	index("clerk_telemetry_event_created_idx").on(table.event, table.createdAt),
	pgPolicy("Clerks insert own telemetry", { as: "permissive", for: "insert", to: ["authenticated"], withCheck: sql`auth.uid() = clerk_id` }),
	pgPolicy("Clerks read own telemetry", { as: "permissive", for: "select", to: ["authenticated"], using: sql`auth.uid() = clerk_id` }),
	pgPolicy("Admins read all telemetry", { as: "permissive", for: "select", to: ["authenticated"], using: sql`has_role(auth.uid(), 'admin'::app_role)` }),
]);

export const tenantDetails = pgTable("tenant_details", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	jobId: uuid("job_id").notNull(),
	fullName: text("full_name"),
	email: text(),
	phone: text(),
	tenantOrder: integer("tenant_order").default(1).notNull(),
	tenantToken: text("tenant_token"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.jobId],
			foreignColumns: [jobs.id],
			name: "tenant_details_job_id_fkey"
		}),
	pgPolicy("Admins can manage all tenant details", { as: "permissive", for: "all", to: ["public"], using: sql`has_role(auth.uid(), 'admin'::app_role)` }),
	pgPolicy("Clerks can view tenant details for their jobs", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("Clients can view tenant details for their jobs", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("Clients can insert tenant details for their jobs", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("Clients can update tenant details for their jobs", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("Org members can view org tenant details", { as: "permissive", for: "select", to: ["authenticated"] }),
	pgPolicy("Org members can insert org tenant details", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("Org members can update org tenant details", { as: "permissive", for: "update", to: ["authenticated"] }),
]);

export const escrowPayments = pgTable("escrow_payments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	jobId: uuid("job_id").notNull(),
	clientId: uuid("client_id").notNull(),
	clerkId: uuid("clerk_id"),
	providerId: uuid("provider_id"),
	grossAmount: numeric("gross_amount").default('0').notNull(),
	platformFee: numeric("platform_fee").default('0').notNull(),
	providerFee: numeric("provider_fee").default('0').notNull(),
	clerkPayout: numeric("clerk_payout").default('0').notNull(),
	cancellationFee: numeric("cancellation_fee").default('0'),
	cancellationReason: text("cancellation_reason"),
	cancelledBy: uuid("cancelled_by"),
	status: text().default('pending').notNull(),
	stripePaymentIntentId: text("stripe_payment_intent_id"),
	stripeTransferId: text("stripe_transfer_id"),
	stripeRefundId: text("stripe_refund_id"),
	heldAt: timestamp("held_at", { withTimezone: true, mode: 'string' }),
	autoReleaseAt: timestamp("auto_release_at", { withTimezone: true, mode: 'string' }),
	releasedAt: timestamp("released_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.jobId],
			foreignColumns: [jobs.id],
			name: "escrow_payments_job_id_fkey"
		}),
	pgPolicy("Providers can view their own escrow payments", { as: "permissive", for: "select", to: ["public"], using: sql`(auth.uid() = provider_id)` }),
	pgPolicy("System can insert escrow payments", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("Admins can view all escrow payments", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("Clients can view their own escrow payments", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("Clients can update their escrow payments", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("Clerks can view their own escrow payments", { as: "permissive", for: "select", to: ["public"] }),
]);

export const messages = pgTable("messages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	jobId: uuid("job_id"),
	senderId: uuid("sender_id").notNull(),
	recipientId: uuid("recipient_id").notNull(),
	messageText: text("message_text").notNull(),
	attachmentUrl: text("attachment_url"),
	read: boolean().default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.jobId],
			foreignColumns: [jobs.id],
			name: "messages_job_id_fkey"
		}),
	pgPolicy("Users can view their own messages", { as: "permissive", for: "select", to: ["public"], using: sql`((auth.uid() = sender_id) OR (auth.uid() = recipient_id))` }),
	pgPolicy("Users can send messages", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("Recipients can mark messages as read", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("Admins can view all messages", { as: "permissive", for: "all", to: ["public"] }),
]);

export const inspectionItemPhotos = pgTable("inspection_item_photos", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	itemId: uuid("item_id").notNull(),
	jobId: uuid("job_id").notNull(),
	photoUrl: text("photo_url").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	pgPolicy("Admins can manage all item photos", { as: "permissive", for: "all", to: ["public"], using: sql`has_role(auth.uid(), 'admin'::app_role)` }),
	pgPolicy("Clerks can manage photos for their jobs", { as: "permissive", for: "all", to: ["public"] }),
	pgPolicy("Clients can view photos for their jobs", { as: "permissive", for: "select", to: ["public"] }),
]);

export const generatedReports = pgTable("generated_reports", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	jobId: uuid("job_id").notNull(),
	generatedBy: uuid("generated_by").notNull(),
	generatedAt: timestamp("generated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	reportUrl: text("report_url"),
	sentToEmail: text("sent_to_email"),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }),
	tenantSignature: text("tenant_signature"),
	// 0040 — the tenant's adopted mark (typed name set in a handwriting
	// face, or drawn). `tenantSignature` above stays as the typed name and
	// remains the identity check against `tenant_details.full_name`.
	tenantSignatureUrl: text("tenant_signature_url"),
	tenantToken: text("tenant_token"),
	signedAt: timestamp("signed_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.jobId],
			foreignColumns: [jobs.id],
			name: "generated_reports_job_id_fkey"
		}),
	pgPolicy("Admins can manage all generated reports", { as: "permissive", for: "all", to: ["public"], using: sql`has_role(auth.uid(), 'admin'::app_role)` }),
	pgPolicy("Clerks can manage reports for their jobs", { as: "permissive", for: "all", to: ["public"] }),
	pgPolicy("Clients can view reports for their jobs", { as: "permissive", for: "select", to: ["public"] }),
]);

export const reviews = pgTable("reviews", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	jobId: uuid("job_id").notNull(),
	reviewerId: uuid("reviewer_id").notNull(),
	revieweeId: uuid("reviewee_id").notNull(),
	rating: integer().notNull(),
	reviewText: text("review_text"),
	clerkResponse: text("clerk_response"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.jobId],
			foreignColumns: [jobs.id],
			name: "reviews_job_id_fkey"
		}),
	pgPolicy("Anyone authenticated can view reviews", { as: "permissive", for: "select", to: ["public"], using: sql`(auth.uid() IS NOT NULL)` }),
	pgPolicy("Users can view reviews they're involved in", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("Reviewers can insert their own reviews", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("Reviewees can update clerk_response only", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("Admins can manage all reviews", { as: "permissive", for: "all", to: ["public"] }),
]);

export const notifications = pgTable("notifications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	type: text().notNull(),
	title: text().notNull(),
	message: text().notNull(),
	link: text(),
	read: boolean().default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	pgPolicy("Users can view their own notifications", { as: "permissive", for: "select", to: ["public"], using: sql`(auth.uid() = user_id)` }),
	pgPolicy("Users can update their own notifications", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("Admins can manage all notifications", { as: "permissive", for: "all", to: ["public"] }),
	pgPolicy("Admins can insert notifications", { as: "permissive", for: "insert", to: ["public"] }),
]);

export const notificationPreferences = pgTable("notification_preferences", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	emailJobUpdates: boolean("email_job_updates").default(true).notNull(),
	emailPaymentUpdates: boolean("email_payment_updates").default(true).notNull(),
	emailReportDelivery: boolean("email_report_delivery").default(true).notNull(),
	emailNewMessages: boolean("email_new_messages").default(true).notNull(),
	emailMarketing: boolean("email_marketing").default(false).notNull(),
	inappJobUpdates: boolean("inapp_job_updates").default(true).notNull(),
	inappPaymentUpdates: boolean("inapp_payment_updates").default(true).notNull(),
	inappReportDelivery: boolean("inapp_report_delivery").default(true).notNull(),
	inappNewMessages: boolean("inapp_new_messages").default(true).notNull(),
	// M0 additions — SMS/WhatsApp + lifecycle reminders (per LISTD_M0_Tasks.md #3).
	smsJobUpdates: boolean("sms_job_updates").default(false).notNull(),
	smsPaymentUpdates: boolean("sms_payment_updates").default(false).notNull(),
	whatsappOptIn: boolean("whatsapp_opt_in").default(false).notNull(),
	emailMidtermReminder: boolean("email_midterm_reminder").default(true).notNull(),
	emailCheckoutReminder: boolean("email_checkout_reminder").default(true).notNull(),
	emailNextServicePrompt: boolean("email_next_service_prompt").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	pgPolicy("Users can view their own preferences", { as: "permissive", for: "select", to: ["public"], using: sql`(auth.uid() = user_id)` }),
	pgPolicy("Users can insert their own preferences", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("Users can update their own preferences", { as: "permissive", for: "update", to: ["public"] }),
]);

export const clerkIncidents = pgTable("clerk_incidents", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clerkId: uuid("clerk_id").notNull(),
	jobId: uuid("job_id"),
	incidentType: text("incident_type").notNull(),
	severity: text().default('flag').notNull(),
	notes: text(),
	restrictPriority: boolean("restrict_priority").default(false).notNull(),
	loggedBy: uuid("logged_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.jobId],
			foreignColumns: [jobs.id],
			name: "clerk_incidents_job_id_fkey"
		}),
	pgPolicy("Clerks can view their own incidents", { as: "permissive", for: "select", to: ["public"], using: sql`(auth.uid() = clerk_id)` }),
	pgPolicy("Admins can manage all clerk incidents", { as: "permissive", for: "all", to: ["public"] }),
]);

export const disputes = pgTable("disputes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	jobId: uuid("job_id").notNull(),
	raisedBy: uuid("raised_by").notNull(),
	raisedAgainst: uuid("raised_against").notNull(),
	reason: text().notNull(),
	description: text(),
	status: text().default('open').notNull(),
	resolution: text(),
	adminNotes: text("admin_notes"),
	resolvedBy: uuid("resolved_by"),
	resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.jobId],
			foreignColumns: [jobs.id],
			name: "disputes_job_id_fkey"
		}),
	pgPolicy("Users can view their own disputes", { as: "permissive", for: "select", to: ["public"], using: sql`((auth.uid() = raised_by) OR (auth.uid() = raised_against))` }),
	pgPolicy("Users can create disputes", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("Admins can manage all disputes", { as: "permissive", for: "all", to: ["public"] }),
]);

export const strikes = pgTable("strikes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clerkId: uuid("clerk_id").notNull(),
	reason: text().notNull(),
	severity: integer().default(1).notNull(),
	issuedBy: uuid("issued_by").notNull(),
	active: boolean().default(true).notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	pgPolicy("Clerks can view their own strikes", { as: "permissive", for: "select", to: ["public"], using: sql`(auth.uid() = clerk_id)` }),
	pgPolicy("Admins can manage all strikes", { as: "permissive", for: "all", to: ["public"] }),
]);

export const waitlistLeads = pgTable("waitlist_leads", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	fullName: text("full_name").notNull(),
	companyName: text("company_name").notNull(),
	email: text().notNull(),
	phone: text(),
	role: text().notNull(),
	portfolioSize: text("portfolio_size"),
	monthlyVolume: text("monthly_volume"),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	pgPolicy("Anyone can submit waitlist lead", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`true`  }),
	pgPolicy("Admins can manage waitlist leads", { as: "permissive", for: "all", to: ["public"] }),
]);

export const xeroConnections = pgTable("xero_connections", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	tenantId: text("tenant_id").notNull(),
	tenantName: text("tenant_name"),
	accessToken: text("access_token").notNull(),
	refreshToken: text("refresh_token").notNull(),
	scopes: text(),
	tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	connectedAt: timestamp("connected_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	pgPolicy("Users can insert their own xero connections", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`(auth.uid() = user_id)`  }),
	pgPolicy("Users can update their own xero connections", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("Users can delete their own xero connections", { as: "permissive", for: "delete", to: ["public"] }),
]);

export const clerkInvitations = pgTable("clerk_invitations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	providerId: uuid("provider_id").notNull(),
	email: text().notNull(),
	token: uuid().defaultRandom().notNull(),
	status: text().default('pending').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).default(sql`(now() + '7 days'::interval)`).notNull(),
	acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	pgPolicy("Admins can view all invitations", { as: "permissive", for: "select", to: ["public"], using: sql`has_role(auth.uid(), 'admin'::app_role)` }),
	pgPolicy("Providers can view their invitations", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("Providers can create invitations", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("Providers can update their invitations", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("Users can accept invitations", { as: "permissive", for: "update", to: ["public"] }),
]);

export const emailLogs = pgTable("email_logs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	functionName: text("function_name").notNull(),
	recipientEmail: text("recipient_email").notNull(),
	subject: text().notNull(),
	status: text().default('sent').notNull(),
	resendId: text("resend_id"),
	errorMessage: text("error_message"),
	metadata: jsonb(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	pgPolicy("Admins can view all email logs", { as: "permissive", for: "select", to: ["public"], using: sql`has_role(auth.uid(), 'admin'::app_role)` }),
]);

// 0022 — SMS delivery log (Twilio). Mirror of email_logs for SMS sends.
// See 0022_sms_logs.sql.
export const smsLogs = pgTable("sms_logs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	functionName: text("function_name").notNull(),
	recipientUserId: uuid("recipient_user_id"),
	recipientPhone: text("recipient_phone").notNull(),
	body: text().notNull(),
	status: text().default('sent').notNull(),
	twilioMessageSid: text("twilio_message_sid"),
	errorCode: text("error_code"),
	errorMessage: text("error_message"),
	metadata: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("sms_logs_recipient_user_idx").on(table.recipientUserId, table.createdAt),
	index("sms_logs_recipient_phone_idx").on(table.recipientPhone, table.createdAt),
	index("sms_logs_status_created_idx").on(table.status, table.createdAt),
	pgPolicy("Admins read all sms logs", { as: "permissive", for: "select", to: ["authenticated"], using: sql`has_role(auth.uid(), 'admin'::app_role)` }),
	pgPolicy("Users read own sms logs", { as: "permissive", for: "select", to: ["authenticated"], using: sql`auth.uid() = recipient_user_id` }),
]);

// M3 #1–4 — Tenant portal token lifecycle. Each row is one issued token;
// rotations append a new row with `rotated_from_id` pointing at the prior
// row. Revocation is a non-null `revoked_at`. The legacy `tenant_token`
// text column on `tenant_details` is kept for back-compat during the
// portal port; new flows resolve through this table.
//
// Service-role writes only — no public INSERT/UPDATE/DELETE policies. The
// route handlers that issue / rotate / revoke tokens are admin-gated or
// system-issued (sign-off completion).
export const tenantTokens = pgTable("tenant_tokens", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	jobId: uuid("job_id").notNull(),
	tenantDetailId: uuid("tenant_detail_id"),
	token: text().notNull(),
	scope: text().array().default([]).notNull(),
	issuedAt: timestamp("issued_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	issuedBy: uuid("issued_by"),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
	revokedBy: uuid("revoked_by"),
	revokedReason: text("revoked_reason"),
	rotatedFromId: uuid("rotated_from_id"),
	rotatedAt: timestamp("rotated_at", { withTimezone: true, mode: 'string' }),
	lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: 'string' }),
	lastUsedIp: text("last_used_ip"),
	lastUsedUserAgent: text("last_used_user_agent"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("tenant_tokens_token_key").on(table.token),
	index("tenant_tokens_job_idx").on(table.jobId),
	index("tenant_tokens_expires_idx").on(table.expiresAt),
	index("tenant_tokens_rotated_from_idx").on(table.rotatedFromId),
	foreignKey({
		columns: [table.jobId],
		foreignColumns: [jobs.id],
		name: "tenant_tokens_job_id_fkey",
	}),
	foreignKey({
		columns: [table.tenantDetailId],
		foreignColumns: [tenantDetails.id],
		name: "tenant_tokens_tenant_detail_id_fkey",
	}),
	pgPolicy("Admins can manage all tenant tokens", { as: "permissive", for: "all", to: ["public"], using: sql`has_role(auth.uid(), 'admin'::app_role)` }),
	pgPolicy("Clerks can view tenant tokens for their jobs", { as: "permissive", for: "select", to: ["public"], using: sql`EXISTS (SELECT 1 FROM jobs WHERE jobs.id = tenant_tokens.job_id AND jobs.clerk_id = auth.uid())` }),
	pgPolicy("Clients can view tenant tokens for their jobs", { as: "permissive", for: "select", to: ["public"], using: sql`EXISTS (SELECT 1 FROM jobs WHERE jobs.id = tenant_tokens.job_id AND jobs.client_id = auth.uid())` }),
]);

// M1 #22 — Append-only audit trail for state transitions across job lifecycle,
// verification, impersonation, pricing overrides, strike issuance, platform-
// setting changes, and tenant-portal access (M3 #10). Writes go through the
// service-role connection only — no INSERT/UPDATE/DELETE policies on the
// authenticated/public side.
export const auditEvents = pgTable("audit_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	category: auditEventCategory().notNull(),
	action: text().notNull(),
	actorUserId: uuid("actor_user_id"),
	targetType: text("target_type"),
	targetId: text("target_id"),
	payload: jsonb().default({}).notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("audit_events_target_idx").on(table.targetType, table.targetId),
	index("audit_events_actor_idx").on(table.actorUserId),
	index("audit_events_created_at_idx").on(table.createdAt),
	pgPolicy("Admins can view all audit events", { as: "permissive", for: "select", to: ["public"], using: sql`has_role(auth.uid(), 'admin'::app_role)` }),
	pgPolicy("Users can view their own audit events", { as: "permissive", for: "select", to: ["public"], using: sql`auth.uid() = actor_user_id` }),
]);

export const platformSettings = pgTable("platform_settings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	key: text().notNull(),
	value: text(),
	updatedBy: uuid("updated_by"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("platform_settings_key_key").on(table.key),
	pgPolicy("Anyone can read platform settings", { as: "permissive", for: "select", to: ["public"], using: sql`true` }),
	pgPolicy("Admins can manage platform settings", { as: "permissive", for: "all", to: ["public"] }),
]);

// ─────────────────────────────────────────────────────────────────────
// 0011 — Inbuilt invoice generator (Phase 0 foundation).
// See Docs/LISTD_Invoice_Generator_Plan.md for the design rationale.
// ─────────────────────────────────────────────────────────────────────

export const taxRates = pgTable("tax_rates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	code: text().notNull(),
	name: text().notNull(),
	rate: numeric().notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	isDefault: boolean("is_default").default(false).notNull(),
	appliesTo: text("applies_to").default('domestic').notNull(),
	notes: text(),
	// 0017 — Xero TaxType code (e.g. 'OUTPUT2' for UK 20% VAT on sales).
	// Admin configures via /admin/settings/tax. Required for the Xero
	// provider; ignored by the inbuilt provider.
	xeroTaxType: text("xero_tax_type"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("tax_rates_code_key").on(table.code),
	pgPolicy("Admins can manage tax rates", { as: "permissive", for: "all", to: ["authenticated"] }),
	pgPolicy("Authenticated users can read active tax rates", { as: "permissive", for: "select", to: ["authenticated"] }),
]);

export const invoiceNumbering = pgTable("invoice_numbering", {
	year: integer().primaryKey().notNull(),
	nextNumber: integer("next_number").default(1).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, () => [
	pgPolicy("Admins can manage numbering", { as: "permissive", for: "all", to: ["authenticated"] }),
]);

// 0015 — Recurring invoice templates. Cron `/api/cron/issue-recurring`
// reads `active = true AND next_run_at <= today`, mints a draft via
// `provider.createInvoice`, optionally auto-issues + sends per
// `auto_action`, then advances `next_run_at` from the cadence.
export const recurringInvoiceTemplates = pgTable("recurring_invoice_templates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clientId: uuid("client_id").notNull(),
	organisationId: uuid("organisation_id"),
	cadence: text().notNull(),
	dayOfMonth: integer("day_of_month"),
	dayOfWeek: integer("day_of_week"),
	endsOn: date("ends_on"),
	startsOn: date("starts_on").default(sql`(now() AT TIME ZONE 'UTC')::date`).notNull(),
	nextRunAt: date("next_run_at").notNull(),
	notes: text(),
	lineItems: jsonb("line_items").default([]).notNull(),
	autoAction: text("auto_action").default('issued').notNull(),
	active: boolean().default(true).notNull(),
	lastRunAt: timestamp("last_run_at", { withTimezone: true, mode: 'string' }),
	lastInvoiceId: uuid("last_invoice_id"),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, () => [
	pgPolicy("Admins can manage recurring templates", { as: "permissive", for: "all", to: ["authenticated"] }),
	pgPolicy("Clients can view their own recurring templates", { as: "permissive", for: "select", to: ["authenticated"] }),
]);

// 0016 — Shareable report links. Issued by an admin to grant a one-shot
// PDF fetch to a third party (accountant, insurer) without an account.
// Resolver lives at `/reports/share/[token]`; storage path is never
// exposed — the resolver streams a fresh Supabase signed URL each time.
export const reportShareTokens = pgTable("report_share_tokens", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	jobId: uuid("job_id").notNull(),
	token: text().notNull(),
	label: text(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	maxViews: integer("max_views"),
	viewCount: integer("view_count").default(0).notNull(),
	lastViewedAt: timestamp("last_viewed_at", { withTimezone: true, mode: 'string' }),
	lastViewedIp: text("last_viewed_ip"),
	lastViewedUserAgent: text("last_viewed_user_agent"),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
	revokedBy: uuid("revoked_by"),
	revokedReason: text("revoked_reason"),
	issuedBy: uuid("issued_by").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("report_share_tokens_token_key").on(table.token),
	pgPolicy("Admins can manage report share tokens", { as: "permissive", for: "all", to: ["authenticated"] }),
]);

// 0014 — Credit-note per-year allocator. Mirrors invoiceNumbering exactly
// but is keyed against the CN-YYYY-NNNNN series so the two counters
// advance independently and never collide.
export const creditNoteNumbering = pgTable("credit_note_numbering", {
	year: integer().primaryKey().notNull(),
	nextNumber: integer("next_number").default(1).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, () => [
	pgPolicy("Admins can manage credit note numbering", { as: "permissive", for: "all", to: ["authenticated"] }),
]);

export const invoices = pgTable("invoices", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	reference: text(),
	status: text().default('draft').notNull(),
	// 0014 — credit-note support. `kind` discriminates an inverse-invoice
	// document (CN-YYYY-NNNNN) from a normal one. A credit note always
	// points at the invoice it offsets via `parentInvoiceId`; regular
	// invoices have it NULL. DB-side CHECKs enforce the invariant.
	kind: text().default('invoice').notNull(),
	parentInvoiceId: uuid("parent_invoice_id"),
	clientId: uuid("client_id").notNull(),
	organisationId: uuid("organisation_id"),
	issueDate: date("issue_date"),
	dueDate: date("due_date"),
	subtotal: numeric().default('0').notNull(),
	taxTotal: numeric("tax_total").default('0').notNull(),
	total: numeric().default('0').notNull(),
	paidTotal: numeric("paid_total").default('0').notNull(),
	currency: text().default('GBP').notNull(),
	notes: text(),
	// Snapshot at issue time: [{ rateId, code, rate, base, tax }]. Stored
	// rather than recomputed so a rate change can't retro-alter issued
	// invoices.
	taxSummary: jsonb("tax_summary").default([]).notNull(),
	pdfUrl: text("pdf_url"),
	issuedAt: timestamp("issued_at", { withTimezone: true, mode: 'string' }),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }),
	paidAt: timestamp("paid_at", { withTimezone: true, mode: 'string' }),
	voidedAt: timestamp("voided_at", { withTimezone: true, mode: 'string' }),
	voidReason: text("void_reason"),
	// 0017 — Xero linking key. Populated only when the active provider is
	// Xero. NULL on inbuilt-provider rows. UNIQUE so a Xero invoice id
	// can't shadow into two LISTD rows.
	xeroInvoiceId: text("xero_invoice_id"),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("invoices_reference_key").on(table.reference),
	unique("invoices_xero_invoice_id_key").on(table.xeroInvoiceId),
	index("invoices_client_idx").on(table.clientId),
	index("invoices_org_idx").on(table.organisationId),
	index("invoices_status_idx").on(table.status),
	index("invoices_issue_date_idx").on(table.issueDate),
	check("invoices_status_check", sql`${table.status} IN ('draft','issued','sent','paid','overdue','void')`),
	pgPolicy("Admins can manage all invoices", { as: "permissive", for: "all", to: ["authenticated"] }),
	pgPolicy("Clients can view their own invoices", { as: "permissive", for: "select", to: ["authenticated"] }),
	pgPolicy("Org members can view org invoices", { as: "permissive", for: "select", to: ["authenticated"] }),
]);

export const invoiceLineItems = pgTable("invoice_line_items", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	invoiceId: uuid("invoice_id").notNull(),
	jobId: uuid("job_id"),
	description: text().notNull(),
	quantity: numeric().default('1').notNull(),
	unitPrice: numeric("unit_price").notNull(),
	taxRateId: uuid("tax_rate_id"),
	lineSubtotal: numeric("line_subtotal").notNull(),
	lineTax: numeric("line_tax").default('0').notNull(),
	position: integer().default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
		columns: [table.invoiceId],
		foreignColumns: [invoices.id],
		name: "invoice_line_items_invoice_id_fkey",
	}).onDelete('cascade'),
	foreignKey({
		columns: [table.jobId],
		foreignColumns: [jobs.id],
		name: "invoice_line_items_job_id_fkey",
	}).onDelete('set null'),
	foreignKey({
		columns: [table.taxRateId],
		foreignColumns: [taxRates.id],
		name: "invoice_line_items_tax_rate_id_fkey",
	}).onDelete('restrict'),
	index("invoice_line_items_invoice_idx").on(table.invoiceId, table.position),
	index("invoice_line_items_job_idx").on(table.jobId),
	pgPolicy("Admins can manage all line items", { as: "permissive", for: "all", to: ["authenticated"] }),
	pgPolicy("Recipients can view line items", { as: "permissive", for: "select", to: ["authenticated"] }),
]);

export const invoicePayments = pgTable("invoice_payments", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	invoiceId: uuid("invoice_id").notNull(),
	paidAmount: numeric("paid_amount").notNull(),
	paidAt: date("paid_at").default(sql`CURRENT_DATE`).notNull(),
	method: text().default('bank_transfer').notNull(),
	reference: text(),
	// 0013 — Stripe pay-by-link (Phase 6). Populated by the
	// `checkout.session.completed` webhook handler. NULL for manually
	// recorded payments (bank transfer, cash, etc).
	stripeCheckoutSessionId: text("stripe_checkout_session_id"),
	stripePaymentIntentId: text("stripe_payment_intent_id"),
	// 0017 — Xero linking key. Populated only when the active provider is
	// Xero (recordPayment mirrors the Xero payment row locally).
	xeroPaymentId: text("xero_payment_id"),
	recordedBy: uuid("recorded_by"),
	note: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
		columns: [table.invoiceId],
		foreignColumns: [invoices.id],
		name: "invoice_payments_invoice_id_fkey",
	}).onDelete('cascade'),
	unique("invoice_payments_xero_payment_id_key").on(table.xeroPaymentId),
	index("invoice_payments_invoice_idx").on(table.invoiceId, table.paidAt),
	index("invoice_payments_stripe_session_idx").on(table.stripeCheckoutSessionId),
	check("invoice_payments_method_check", sql`${table.method} IN ('bank_transfer','card','cash','stripe','other')`),
	pgPolicy("Admins can manage all payments", { as: "permissive", for: "all", to: ["authenticated"] }),
	pgPolicy("Recipients can view payments", { as: "permissive", for: "select", to: ["authenticated"] }),
]);

// 0009 — Admin-curated inspection report templates. See
// `src/db/migrations/0009_report_templates.sql`.
export const reportTemplates = pgTable("report_templates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	// [{ name: 'Kitchen', items: [{ name: 'Oven' }] }, ...]
	structure: jsonb().default([]).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("report_templates_active_idx").on(table.isActive),
	index("report_templates_created_at_idx").on(table.createdAt),
	pgPolicy("Admins can manage report templates", { as: "permissive", for: "all", to: ["authenticated"] }),
	pgPolicy("Clerks can read active report templates", { as: "permissive", for: "select", to: ["authenticated"] }),
]);

export const propertyChangeLogs = pgTable("property_change_logs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	propertyId: uuid("property_id").notNull(),
	changedBy: uuid("changed_by").notNull(),
	changes: jsonb().notNull(),
	mayAffectPricing: boolean("may_affect_pricing").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "property_change_logs_property_id_fkey"
		}),
	pgPolicy("Admins can view all change logs", { as: "permissive", for: "select", to: ["public"], using: sql`has_role(auth.uid(), 'admin'::app_role)` }),
	pgPolicy("Clients can view change logs for their properties", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("Clients can insert change logs for their properties", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("Clerks can view change logs for their job properties", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("Org members can view org property change logs", { as: "permissive", for: "select", to: ["authenticated"] }),
]);

export const upsellNotificationsSent = pgTable("upsell_notifications_sent", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	jobId: uuid("job_id").notNull(),
	ruleName: text("rule_name").notNull(),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.jobId],
			foreignColumns: [jobs.id],
			name: "upsell_notifications_sent_job_id_fkey"
		}),
	unique("upsell_notifications_sent_job_rule_key").on(table.jobId, table.ruleName),
	pgPolicy("Admins can manage all upsell notifications sent", { as: "permissive", for: "all", to: ["public"], using: sql`has_role(auth.uid(), 'admin'::app_role)` }),
	pgPolicy("Service role can insert upsell notifications sent", { as: "permissive", for: "insert", to: ["public"] }),
]);

// 0020 — Pre-appointment reminder idempotency log. See
// 0020_appointment_reminders.sql.
export const appointmentRemindersSent = pgTable("appointment_reminders_sent", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	jobId: uuid("job_id").notNull(),
	kind: text().notNull(),
	recipientCount: integer("recipient_count").default(0).notNull(),
	emailSentCount: integer("email_sent_count").default(0).notNull(),
	emailSkippedCount: integer("email_skipped_count").default(0).notNull(),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
		columns: [table.jobId],
		foreignColumns: [jobs.id],
		name: "appointment_reminders_sent_job_id_fkey",
	}).onDelete('cascade'),
	unique("appointment_reminders_sent_job_kind_uniq").on(table.jobId, table.kind),
	index("appointment_reminders_sent_sent_at_idx").on(table.sentAt),
	pgPolicy("Admins read all appointment reminders", { as: "permissive", for: "select", to: ["authenticated"], using: sql`has_role(auth.uid(), 'admin'::app_role)` }),
]);

// 0021 — Web Push subscriptions (one row per browser endpoint per user).
// See 0021_push_and_scheduled_at.sql.
export const pushSubscriptions = pgTable("push_subscriptions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	endpoint: text().notNull(),
	p256dh: text().notNull(),
	auth: text().notNull(),
	source: text().default('mobile-clerk-pwa').notNull(),
	userAgent: text("user_agent"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: 'string' }),
	lastError: text("last_error"),
	lastErrorAt: timestamp("last_error_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	unique("push_subscriptions_endpoint_uniq").on(table.endpoint),
	index("push_subscriptions_user_id_idx").on(table.userId),
	pgPolicy("Users insert own push subscriptions", { as: "permissive", for: "insert", to: ["authenticated"], withCheck: sql`auth.uid() = user_id` }),
	pgPolicy("Users read own push subscriptions", { as: "permissive", for: "select", to: ["authenticated"], using: sql`auth.uid() = user_id` }),
	pgPolicy("Users delete own push subscriptions", { as: "permissive", for: "delete", to: ["authenticated"], using: sql`auth.uid() = user_id` }),
	pgPolicy("Admins read all push subscriptions", { as: "permissive", for: "select", to: ["authenticated"], using: sql`has_role(auth.uid(), 'admin'::app_role)` }),
]);

export const reports = pgTable("reports", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	jobId: uuid("job_id"),
	clerkId: uuid("clerk_id"),
	pdfUrl: text("pdf_url"),
	status: text().default('submitted'),
	adminNotes: text("admin_notes"),
	submittedAt: timestamp("submitted_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	approvedAt: timestamp("approved_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	check("reports_status_check", sql`status = ANY (ARRAY['submitted'::text, 'approved'::text, 'returned'::text, 'rejected'::text])`),
]);

export const jobs = pgTable("jobs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	propertyId: uuid("property_id").notNull(),
	clientId: uuid("client_id").notNull(),
	providerId: uuid("provider_id"),
	clerkId: uuid("clerk_id"),
	// 0023 — text (was the `inspection_type` enum) so admin-defined service
	// types are allowed. Built-in keys remain valid values.
	inspectionType: text("inspection_type").notNull(),
	inspectionTypes: text("inspection_types").array(),
	scheduledDate: date("scheduled_date").notNull(),
	preferredTimeSlot: text("preferred_time_slot"),
	// 0021 — precise inspection start (UTC). Nullable for back-compat with
	// rows that pre-date the column; populated by the booking flow + admin
	// reschedule tooling going forward. Drives the soon-reminders cron.
	scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: 'string' }),
	status: jobStatus().default('draft').notNull(),
	serviceTier: text("service_tier").default('standard').notNull(),
	specialInstructions: text("special_instructions"),
	quotedPrice: numeric("quoted_price"),
	finalPrice: numeric("final_price"),
	shortNoticeSurchargeApplied: boolean("short_notice_surcharge_applied").default(false).notNull(),
	clerkPayout: numeric("clerk_payout").default('0'),
	clerkBonus: numeric("clerk_bonus").default('0'),
	clerkFinalPayout: numeric("clerk_final_payout").default('0'),
	clerkPayoutLocked: boolean("clerk_payout_locked").default(false),
	clerkPaymentDate: timestamp("clerk_payment_date", { withTimezone: true, mode: 'string' }),
	clerkLevelAtJob: integer("clerk_level_at_job").default(1),
	clerkPayoutBreakdown: jsonb("clerk_payout_breakdown").default({}),
	clerkPayoutLog: jsonb("clerk_payout_log").default([]),
	// 0024 — cleaner assignment + payout (cleaning jobs use these, not the
	// clerk_* columns). Clean level lives on inspection_type (clean_light|…).
	cleanerId: uuid("cleaner_id"),
	cleanerPayout: numeric("cleaner_payout").default('0'),
	cleanerFinalPayout: numeric("cleaner_final_payout").default('0'),
	cleanerPayoutLocked: boolean("cleaner_payout_locked").default(false),
	cleanerPaymentDate: timestamp("cleaner_payment_date", { withTimezone: true, mode: 'string' }),
	cleanerPayoutBreakdown: jsonb("cleaner_payout_breakdown").default({}),
	// 0025 — cleaning completion artifact: { checkedTasks, notes, photos[], completedAt }
	cleaningChecklist: jsonb("cleaning_checklist").default({}),
	// 0026 — tenant-chosen inspection slots: { slots[], selectedAt, tenantDetailId }
	tenantSelectedSlots: jsonb("tenant_selected_slots").default({}),
	margin: numeric().default('0'),
	clientPreInspectionAck: boolean("client_pre_inspection_ack").default(false),
	clientPreInspectionAckAt: timestamp("client_pre_inspection_ack_at", { withTimezone: true, mode: 'string' }),
	clientReportAccepted: boolean("client_report_accepted").default(false),
	clientReportAcceptedAt: timestamp("client_report_accepted_at", { withTimezone: true, mode: 'string' }),
	clientReportComments: text("client_report_comments"),
	clientSignatureUrl: text("client_signature_url"),
	clientSignatureAt: timestamp("client_signature_at", { withTimezone: true, mode: 'string' }),
	// 0033 — client signs by typed name (client-signoff services), and/or
	// acknowledges read & receipt (tenant-signoff services).
	clientSignatureName: text("client_signature_name"),
	clientReportAcknowledgedAt: timestamp("client_report_acknowledged_at", { withTimezone: true, mode: 'string' }),
	clerkReportSubmittedAck: boolean("clerk_report_submitted_ack").default(false),
	clerkReportSubmittedAckAt: timestamp("clerk_report_submitted_ack_at", { withTimezone: true, mode: 'string' }),
	providerJobCompletedAck: boolean("provider_job_completed_ack").default(false),
	providerJobCompletedAckAt: timestamp("provider_job_completed_ack_at", { withTimezone: true, mode: 'string' }),
	tierAcknowledgedAt: timestamp("tier_acknowledged_at", { withTimezone: true, mode: 'string' }),
	policyAcknowledgedAt: timestamp("policy_acknowledged_at", { withTimezone: true, mode: 'string' }),
	acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: 'string' }),
	deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: 'string' }),
	cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: 'string' }),
	cancelledBy: uuid("cancelled_by"),
	cancellationFee: numeric("cancellation_fee").default('0'),
	rescheduleRequestedDate: date("reschedule_requested_date"),
	rescheduleRequestedTimeSlot: text("reschedule_requested_time_slot"),
	rescheduleRequestedAt: timestamp("reschedule_requested_at", { withTimezone: true, mode: 'string' }),
	rescheduleResolvedBy: uuid("reschedule_resolved_by"),
	rescheduleResolvedAt: timestamp("reschedule_resolved_at", { withTimezone: true, mode: 'string' }),
	rescheduleStatus: text("reschedule_status"),
	createdByUserId: uuid("created_by_user_id"),
	createdByName: text("created_by_name"),
	assignedBy: uuid("assigned_by"),
	assignedByName: text("assigned_by_name"),
	organisationId: uuid("organisation_id"),
	inventorybaseJobId: text("inventorybase_job_id"),
	reportUrl: text("report_url"),
	reviewEmailSentAt: timestamp("review_email_sent_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	recycleStage: integer("recycle_stage").default(0).notNull(),
	isRecycledUrgent: boolean("is_recycled_urgent").default(false).notNull(),
	// 0008 — admin job-detail surface (Lovable parity)
	adminNotes: text("admin_notes"),
	accessMethod: text("access_method"),
	accessCollection: text("access_collection"),
	accessParkingNotes: text("access_parking_notes"),
	// `job_ref_seq` sequence assigns the value via Postgres default; Drizzle
	// just needs to know it's a server-side default so inserts don't require
	// the field. See migration 0008.
	jobRefNumber: integer("job_ref_number").default(sql`nextval('public.job_ref_seq')`).notNull(),
	// 0011 — denormalised pointer so the admin Job Detail can surface the
	// invoice without joining through invoice_line_items. Nullable: not
	// every job is invoiced (drafts, cancellations).
	invoiceId: uuid("invoice_id"),
	// 0035 — promo redemption stamp. promo_kind is denormalised from the
	// code ('discount' | 'invoice_later') so debt + month-end billing queries
	// never join. For invoice_later jobs, invoice_id NULL = not yet swept
	// into a month-end invoice.
	promoCodeId: uuid("promo_code_id"),
	promoKind: text("promo_kind"),
	promoDiscount: numeric("promo_discount"),
	// 0042 — new interface backend.
	groupId: uuid("group_id"),
	scope: jsonb().default({}).notNull(),
	sched: text(),
	proBase: jsonb("pro_base"),
	requiredLevel: integer("required_level"),
	clientReviewDueAt: timestamp("client_review_due_at", { withTimezone: true, mode: 'string' }),
	approvedAt: timestamp("approved_at", { withTimezone: true, mode: 'string' }),
	approvalMode: text("approval_mode"),
	payoutEligibleAt: timestamp("payout_eligible_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.propertyId],
			foreignColumns: [properties.id],
			name: "jobs_property_id_fkey"
		}),
	pgPolicy("Clients can view their own jobs", { as: "permissive", for: "select", to: ["public"], using: sql`(auth.uid() = client_id)` }),
	pgPolicy("Clients can insert their own jobs", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("Clients can update their own jobs", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("Clerks can view their assigned jobs", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("Clerks can update their assigned jobs", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("Clerks can view published jobs", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("Providers can view their jobs", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("Providers can update their jobs", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("Admins can manage all jobs", { as: "permissive", for: "all", to: ["public"] }),
	pgPolicy("Org members can view org jobs", { as: "permissive", for: "select", to: ["authenticated"] }),
	pgPolicy("Org members can insert org jobs", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("Org members can update org jobs", { as: "permissive", for: "update", to: ["authenticated"] }),
]);

// 0035 — promo codes. Admin-generated, lifecycle-managed (validity window,
// redemption cap, enable/disable). kind='discount' takes percent_off on the
// service types in service_types (empty = all); kind='invoice_later' skips
// payment at posting — debt accrues and is swept into a month-end invoice.
export const promoCodes = pgTable("promo_codes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	code: text().notNull(),
	kind: text().default('discount').notNull(),
	percentOff: integer("percent_off"),
	serviceTypes: text("service_types").array(),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'string' }),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
	maxRedemptions: integer("max_redemptions"),
	redemptionCount: integer("redemption_count").default(0).notNull(),
	enabled: boolean().default(true).notNull(),
	// 0036 — non-empty = private code: only these clients can use it, and it
	// auto-applies (prefilled) on their bookings. NULL/empty = public.
	assignedClientIds: uuid("assigned_client_ids").array(),
	notes: text(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("promo_codes_code_key").on(table.code),
	pgPolicy("Admins manage promo codes", { as: "permissive", for: "all", to: ["authenticated"], using: sql`has_role(auth.uid(), 'admin'::app_role)` }),
]);

// 0037 — LISTD-hosted job applications (careers). vacancy_id points into the
// platform_settings vacancies blob; title is snapshotted so the row survives
// the vacancy being deleted. CVs live in the private `job-applications`
// bucket, service-role access only.
export const jobApplications = pgTable("job_applications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	vacancyId: text("vacancy_id").notNull(),
	vacancyTitle: text("vacancy_title").notNull(),
	fullName: text("full_name").notNull(),
	email: text().notNull(),
	phone: text(),
	linkedinUrl: text("linkedin_url"),
	coverNote: text("cover_note"),
	cvPath: text("cv_path"),
	status: text().default('new').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("job_applications_vacancy_idx").on(table.vacancyId, table.createdAt),
	pgPolicy("Admins manage job applications", { as: "permissive", for: "all", to: ["authenticated"], using: sql`has_role(auth.uid(), 'admin'::app_role)` }),
]);

export const notificationQueue = pgTable("notification_queue", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	channel: text().default('email').notNull(),
	subject: text(),
	body: text().notNull(),
	status: text().default('queued').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	processedAt: timestamp("processed_at", { withTimezone: true, mode: 'string' }),
	errorMessage: text("error_message"),
}, (table) => [
	pgPolicy("Admins can manage notification queue", { as: "permissive", for: "all", to: ["public"], using: sql`has_role(auth.uid(), 'admin'::app_role)` }),
]);

export const notificationAutomationSettings = pgTable("notification_automation_settings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	settingKey: text("setting_key").notNull(),
	value: numeric().default('0').notNull(),
	label: text().notNull(),
	category: text().default('general').notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedBy: uuid("updated_by"),
}, (table) => [
	unique("notification_automation_settings_setting_key_key").on(table.settingKey),
	pgPolicy("Admins can manage automation settings", { as: "permissive", for: "all", to: ["public"], using: sql`has_role(auth.uid(), 'admin'::app_role)` }),
	pgPolicy("Authenticated users can view automation settings", { as: "permissive", for: "select", to: ["authenticated"] }),
]);

// 0027 — Stripe Connect escrow. One row per paid job. Amounts in minor units
// (pence). Funds are HELD on the platform at booking and TRANSFERRED to the
// accepting clerk's connected account when the report is approved in QA.
export const escrowTransactions = pgTable("escrow_transactions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	jobId: uuid("job_id").notNull(),
	clientUserId: uuid("client_user_id").notNull(),
	clerkId: uuid("clerk_id"),
	currency: text().default('gbp').notNull(),
	grossAmount: integer("gross_amount").notNull(),
	clerkAmount: integer("clerk_amount").notNull(),
	platformFee: integer("platform_fee").notNull(),
	status: text().default('pending').notNull(),
	stripeCheckoutSessionId: text("stripe_checkout_session_id"),
	stripePaymentIntent: text("stripe_payment_intent"),
	stripeChargeId: text("stripe_charge_id"),
	stripeTransferId: text("stripe_transfer_id"),
	stripeRefundId: text("stripe_refund_id"),
	transferGroup: text("transfer_group"),
	heldAt: timestamp("held_at", { withTimezone: true, mode: 'string' }),
	releasedAt: timestamp("released_at", { withTimezone: true, mode: 'string' }),
	refundedAt: timestamp("refunded_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("escrow_job_idx").on(table.jobId),
	index("escrow_status_idx").on(table.status),
	index("escrow_session_idx").on(table.stripeCheckoutSessionId),
	index("escrow_pi_idx").on(table.stripePaymentIntent),
]);

// 0029 — Operational logs (payment / application / error) for troubleshooting.
// Written by the service-role logger (src/lib/logging/logger.ts); rolled up
// daily to the private `logs` bucket by /api/cron/export-logs.
export const appLogs = pgTable("app_logs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ts: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	level: text().default('info').notNull(),
	channel: text().default('application').notNull(),
	event: text(),
	message: text(),
	context: jsonb().default({}).notNull(),
	requestId: text("request_id"),
	actorUserId: uuid("actor_user_id"),
	route: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("app_logs_channel_ts_idx").on(table.channel, table.ts),
	index("app_logs_level_ts_idx").on(table.level, table.ts),
	index("app_logs_ts_idx").on(table.ts),
]);

// 0038 — Job site events (arrival check-in / running-late / no-access).
// First build slice of the Service Delivery & Protection Framework: the
// assigned pro (clerk OR cleaner) files timestamped, geo-stamped, photo-
// backed events from the property. Photos live in the private `job-photos`
// bucket under `<jobId>/…` so retention + DSAR sweeps already cover them.
export const jobSiteEvents = pgTable("job_site_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	jobId: uuid("job_id").notNull(),
	actorUserId: uuid("actor_user_id").notNull(),
	actorRole: text("actor_role").notNull(),
	kind: text().notNull(),
	note: text(),
	etaMinutes: integer("eta_minutes"),
	reason: text(),
	waitFrom: timestamp("wait_from", { withTimezone: true, mode: 'string' }),
	waitUntil: timestamp("wait_until", { withTimezone: true, mode: 'string' }),
	contactAttempts: jsonb("contact_attempts").default([]).notNull(),
	latitude: doublePrecision(),
	longitude: doublePrecision(),
	accuracyM: doublePrecision("accuracy_m"),
	photoPaths: jsonb("photo_paths").default([]).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
		columns: [table.jobId],
		foreignColumns: [jobs.id],
		name: "job_site_events_job_id_fkey",
	}).onDelete('cascade'),
	index("job_site_events_job_created_idx").on(table.jobId, table.createdAt),
	index("job_site_events_kind_created_idx").on(table.kind, table.createdAt),
	check("job_site_events_kind_check", sql`kind IN ('arrival', 'running_late', 'no_access')`),
	check("job_site_events_actor_role_check", sql`actor_role IN ('clerk', 'cleaner', 'admin')`),
]);

// ── 0042: new interface backend ──────────────────────────────────────────
// RLS is on with no policies, so these are server-side only (withServiceRole).

export const jobQuotes = pgTable("job_quotes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: 'cascade' }),
	version: integer().notNull(),
	lines: jsonb().notNull(),
	subP: integer("sub_p").notNull(),
	taxP: integer("tax_p").default(0).notNull(),
	discP: integer("disc_p").default(0).notNull(),
	totalP: integer("total_p").notNull(),
	proFeeP: integer("pro_fee_p"),
	durationMin: integer("duration_min"),
	exclusions: text(),
	why: text(),
	status: text().default('ISSUED').notNull(),
	auto: boolean().default(false).notNull(),
	declineReason: text("decline_reason"),
	issuedBy: uuid("issued_by"),
	issuedAt: timestamp("issued_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
	acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [unique("job_quotes_job_id_version_key").on(table.jobId, table.version)])

export const changeOrders = pgTable("change_orders", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: 'cascade' }),
	proposedBy: uuid("proposed_by"),
	description: text().notNull(),
	estimateP: integer("estimate_p"),
	lines: jsonb(),
	totalP: integer("total_p"),
	proFeeP: integer("pro_fee_p"),
	creditP: integer("credit_p").default(0).notNull(),
	status: text().default('PROPOSED').notNull(),
	stripeCheckoutSessionId: text("stripe_checkout_session_id"),
	stripeChargeId: text("stripe_charge_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	pricedAt: timestamp("priced_at", { withTimezone: true, mode: 'string' }),
	approvedAt: timestamp("approved_at", { withTimezone: true, mode: 'string' }),
	paidAt: timestamp("paid_at", { withTimezone: true, mode: 'string' }),
})

export const proRoleLevels = pgTable("pro_role_levels", {
	userId: uuid("user_id").notNull(),
	role: text().notNull(),
	level: integer().default(1).notNull(),
	standardsPassedAt: timestamp("standards_passed_at", { withTimezone: true, mode: 'string' }),
	standardsPassedBy: uuid("standards_passed_by"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.role] })])

export const levelApplications = pgTable("level_applications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	role: text().notNull(),
	fromLevel: integer("from_level").notNull(),
	toLevel: integer("to_level").notNull(),
	status: text().default('PENDING').notNull(),
	note: text(),
	snapshot: jsonb().default({}).notNull(),
	decidedBy: uuid("decided_by"),
	decisionReason: text("decision_reason"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	decidedAt: timestamp("decided_at", { withTimezone: true, mode: 'string' }),
})

export const trainings = pgTable("trainings", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	title: text().notNull(),
	description: text(),
	kind: text().notNull(),
	url: text().notNull(),
	role: text(),
	level: integer().default(0).notNull(),
	minutes: integer(),
	status: text().default('DRAFT').notNull(),
	createdBy: uuid("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
})

export const trainingCompletions = pgTable("training_completions", {
	trainingId: uuid("training_id").notNull().references(() => trainings.id, { onDelete: 'cascade' }),
	userId: uuid("user_id").notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.trainingId, table.userId] })])

export const clientRebates = pgTable("client_rebates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	clientId: uuid("client_id").notNull(),
	month: text().notNull(),
	amountP: integer("amount_p").notNull(),
	recordedBy: uuid("recorded_by"),
	note: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [unique("client_rebates_client_id_month_key").on(table.clientId, table.month)])

export const payoutRuns = pgTable("payout_runs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	finishedAt: timestamp("finished_at", { withTimezone: true, mode: 'string' }),
	paidCount: integer("paid_count").default(0).notNull(),
	skippedCount: integer("skipped_count").default(0).notNull(),
	paidP: integer("paid_p").default(0).notNull(),
	detail: jsonb().default([]).notNull(),
})
