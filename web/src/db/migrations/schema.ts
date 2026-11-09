import { pgTable, unique, pgPolicy, uuid, timestamp, foreignKey, text, integer, boolean, jsonb, numeric, date, check, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const appRole = pgEnum("app_role", ['client', 'provider', 'clerk', 'admin'])
export const conditionRating = pgEnum("condition_rating", ['excellent', 'good', 'fair', 'poor', 'damaged', 'missing', 'na'])
export const furnishedStatus = pgEnum("furnished_status", ['furnished', 'unfurnished', 'part_furnished'])
export const inspectionType = pgEnum("inspection_type", ['new_inventory', 'check_in', 'check_out', 'mid_term', 'interim'])
export const itemCondition = pgEnum("item_condition", ['good', 'fair', 'poor', 'na'])
export const jobStatus = pgEnum("job_status", ['draft', 'pending', 'published', 'accepted', 'assigned', 'in_progress', 'submitted', 'reviewed', 'signed', 'completed', 'paid', 'cancelled'])
export const propertyType = pgEnum("property_type", ['studio', '1_bed', '2_bed', '3_bed', '4_bed', '5_bed', '6_bed', '7_bed', '8_bed', '9_bed'])
export const roomType = pgEnum("room_type", ['entrance', 'hallway', 'living_room', 'dining_room', 'kitchen', 'bedroom', 'bathroom', 'toilet', 'utility', 'storage', 'garden', 'garage', 'balcony', 'other'])


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
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	billingAddress: text("billing_address"),
	vatNumber: text("vat_number"),
	companyRegNumber: text("company_reg_number"),
	logoUrl: text("logo_url"),
}, (table) => [
	pgPolicy("Members can view their own organisation", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(id = get_user_org_id(auth.uid()))` }),
	pgPolicy("Clients can create organisations", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("Owners can update their organisation", { as: "permissive", for: "update", to: ["authenticated"] }),
	pgPolicy("Admins can view all organisations", { as: "permissive", for: "select", to: ["authenticated"] }),
]);

export const properties = pgTable("properties", {
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
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.jobId],
			foreignColumns: [jobs.id],
			name: "inspection_rooms_map_job_id_fkey"
		}),
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
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	smsJobUpdates: boolean("sms_job_updates").default(false).notNull(),
	smsPaymentUpdates: boolean("sms_payment_updates").default(false).notNull(),
	whatsappOptIn: boolean("whatsapp_opt_in").default(false).notNull(),
	emailMidtermReminder: boolean("email_midterm_reminder").default(true).notNull(),
	emailCheckoutReminder: boolean("email_checkout_reminder").default(true).notNull(),
	emailNextServicePrompt: boolean("email_next_service_prompt").default(true).notNull(),
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
	isSuperAdmin: boolean("is_super_admin").default(false).notNull(),
	providerId: uuid("provider_id"),
	verificationDocuments: jsonb("verification_documents").default([]),
	verificationStatus: text("verification_status").default('unverified'),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	roleSubtype: text("role_subtype"),
	termsOfBusinessSignedAt: timestamp("terms_of_business_signed_at", { withTimezone: true, mode: 'string' }),
	coverageAreas: text("coverage_areas").array(),
	serviceTypesOffered: text("service_types_offered").array(),
	vehicleDetails: text("vehicle_details"),
	languages: text().array(),
	emergencyContactName: text("emergency_contact_name"),
	emergencyContactPhone: text("emergency_contact_phone"),
	dbsCertificateUrl: text("dbs_certificate_url"),
	qualification: text(),
	insuranceDetails: text("insurance_details"),
	insuranceExpiry: date("insurance_expiry"),
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
	inspectionType: inspectionType("inspection_type").notNull(),
	inspectionTypes: text("inspection_types").array(),
	scheduledDate: date("scheduled_date").notNull(),
	preferredTimeSlot: text("preferred_time_slot"),
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
	margin: numeric().default('0'),
	clientPreInspectionAck: boolean("client_pre_inspection_ack").default(false),
	clientPreInspectionAckAt: timestamp("client_pre_inspection_ack_at", { withTimezone: true, mode: 'string' }),
	clientReportAccepted: boolean("client_report_accepted").default(false),
	clientReportAcceptedAt: timestamp("client_report_accepted_at", { withTimezone: true, mode: 'string' }),
	clientReportComments: text("client_report_comments"),
	clientSignatureUrl: text("client_signature_url"),
	clientSignatureAt: timestamp("client_signature_at", { withTimezone: true, mode: 'string' }),
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
