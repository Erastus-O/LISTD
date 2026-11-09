-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TYPE "public"."app_role" AS ENUM('client', 'provider', 'clerk', 'admin');--> statement-breakpoint
CREATE TYPE "public"."condition_rating" AS ENUM('excellent', 'good', 'fair', 'poor', 'damaged', 'missing', 'na');--> statement-breakpoint
CREATE TYPE "public"."furnished_status" AS ENUM('furnished', 'unfurnished', 'part_furnished');--> statement-breakpoint
CREATE TYPE "public"."inspection_type" AS ENUM('new_inventory', 'check_in', 'check_out', 'mid_term', 'interim');--> statement-breakpoint
CREATE TYPE "public"."item_condition" AS ENUM('good', 'fair', 'poor', 'na');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('draft', 'pending', 'published', 'accepted', 'assigned', 'in_progress', 'submitted', 'reviewed', 'signed', 'completed', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."property_type" AS ENUM('studio', '1_bed', '2_bed', '3_bed', '4_bed', '5_bed', '6_bed', '7_bed', '8_bed', '9_bed');--> statement-breakpoint
CREATE TYPE "public"."room_type" AS ENUM('entrance', 'hallway', 'living_room', 'dining_room', 'kitchen', 'bedroom', 'bathroom', 'toilet', 'utility', 'storage', 'garden', 'garage', 'balcony', 'other');--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"full_name" text,
	"company_name" text,
	"phone" text,
	"avatar_url" text,
	"onboarding_completed" boolean DEFAULT false NOT NULL,
	"terms_agreed_at" timestamp with time zone,
	"non_circumvention_agreed_at" timestamp with time zone,
	"clerk_jobs_completed" integer DEFAULT 0,
	"clerk_rating" numeric DEFAULT '0',
	"clerk_level" integer DEFAULT 1,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"provider_id" uuid,
	"verification_documents" jsonb DEFAULT '[]'::jsonb,
	"verification_status" text DEFAULT 'unverified',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_user_id_key" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "app_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_key" UNIQUE("user_id","role")
);
--> statement-breakpoint
ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organisation_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"org_role" text DEFAULT 'staff' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"invite_token" uuid DEFAULT gen_random_uuid(),
	"invited_at" timestamp with time zone,
	"invited_email" text,
	"last_active_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organisation_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organisations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"address_line_1" text NOT NULL,
	"address_line_2" text,
	"city" text NOT NULL,
	"postcode" text NOT NULL,
	"property_type" "property_type" DEFAULT 'studio' NOT NULL,
	"bedrooms" integer DEFAULT 0 NOT NULL,
	"bathrooms" integer DEFAULT 1 NOT NULL,
	"kitchens" integer DEFAULT 1 NOT NULL,
	"living_rooms" integer DEFAULT 1 NOT NULL,
	"dining_areas" integer DEFAULT 0 NOT NULL,
	"utility_rooms" integer DEFAULT 0 NOT NULL,
	"storage_rooms" integer DEFAULT 0 NOT NULL,
	"hallways_stairs" integer DEFAULT 0 NOT NULL,
	"gardens" integer DEFAULT 0 NOT NULL,
	"communal_areas" integer DEFAULT 0 NOT NULL,
	"furnished_status" "furnished_status" DEFAULT 'unfurnished' NOT NULL,
	"heavily_furnished" boolean DEFAULT false NOT NULL,
	"notes" text,
	"organisation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "properties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inspection_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"clerk_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now(),
	"completed_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"general_notes" text,
	"meter_readings" jsonb DEFAULT '{}'::jsonb,
	"keys_info" jsonb DEFAULT '{}'::jsonb,
	"smoke_alarms_checked" boolean DEFAULT false,
	"carbon_monoxide_checked" boolean DEFAULT false,
	"clerk_signature_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inspection_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inspection_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"room_type" "room_type" NOT NULL,
	"room_name" text NOT NULL,
	"room_order" integer DEFAULT 0 NOT NULL,
	"overall_condition" "condition_rating",
	"notes" text,
	"completed" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inspection_rooms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inspection_items_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"item_name" text NOT NULL,
	"condition" "item_condition" DEFAULT 'na',
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inspection_items_map" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inspection_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"item_name" text NOT NULL,
	"item_category" text,
	"item_order" integer DEFAULT 0 NOT NULL,
	"description" text,
	"condition" "condition_rating",
	"condition_notes" text,
	"cleanliness" text,
	"cleanliness_notes" text,
	"quantity" integer DEFAULT 1,
	"completed" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inspection_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inspection_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"room_id" uuid,
	"item_id" uuid,
	"photo_url" text NOT NULL,
	"caption" text,
	"taken_at" timestamp with time zone DEFAULT now(),
	"is_mandatory" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inspection_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inspection_rooms_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"room_name" text NOT NULL,
	"room_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inspection_rooms_map" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenant_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"full_name" text,
	"email" text,
	"phone" text,
	"tenant_order" integer DEFAULT 1 NOT NULL,
	"tenant_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_details" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "escrow_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"clerk_id" uuid,
	"provider_id" uuid,
	"gross_amount" numeric DEFAULT '0' NOT NULL,
	"platform_fee" numeric DEFAULT '0' NOT NULL,
	"provider_fee" numeric DEFAULT '0' NOT NULL,
	"clerk_payout" numeric DEFAULT '0' NOT NULL,
	"cancellation_fee" numeric DEFAULT '0',
	"cancellation_reason" text,
	"cancelled_by" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"stripe_payment_intent_id" text,
	"stripe_transfer_id" text,
	"stripe_refund_id" text,
	"held_at" timestamp with time zone,
	"auto_release_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "escrow_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"message_text" text NOT NULL,
	"attachment_url" text,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inspection_item_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"photo_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inspection_item_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "generated_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"generated_by" uuid NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"report_url" text,
	"sent_to_email" text,
	"sent_at" timestamp with time zone,
	"tenant_signature" text,
	"tenant_token" text,
	"signed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "generated_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"reviewee_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"review_text" text,
	"clerk_response" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"link" text,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email_job_updates" boolean DEFAULT true NOT NULL,
	"email_payment_updates" boolean DEFAULT true NOT NULL,
	"email_report_delivery" boolean DEFAULT true NOT NULL,
	"email_new_messages" boolean DEFAULT true NOT NULL,
	"email_marketing" boolean DEFAULT false NOT NULL,
	"inapp_job_updates" boolean DEFAULT true NOT NULL,
	"inapp_payment_updates" boolean DEFAULT true NOT NULL,
	"inapp_report_delivery" boolean DEFAULT true NOT NULL,
	"inapp_new_messages" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "clerk_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_id" uuid NOT NULL,
	"job_id" uuid,
	"incident_type" text NOT NULL,
	"severity" text DEFAULT 'flag' NOT NULL,
	"notes" text,
	"restrict_priority" boolean DEFAULT false NOT NULL,
	"logged_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clerk_incidents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"raised_by" uuid NOT NULL,
	"raised_against" uuid NOT NULL,
	"reason" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"admin_notes" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "disputes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "strikes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"severity" integer DEFAULT 1 NOT NULL,
	"issued_by" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "strikes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "waitlist_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"company_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"role" text NOT NULL,
	"portfolio_size" text,
	"monthly_volume" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "waitlist_leads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "xero_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"tenant_name" text,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"scopes" text,
	"token_expires_at" timestamp with time zone NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "xero_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "clerk_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
	"accepted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "clerk_invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "email_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"function_name" text NOT NULL,
	"recipient_email" text NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"resend_id" text,
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_settings_key_key" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "platform_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "property_change_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"changed_by" uuid NOT NULL,
	"changes" jsonb NOT NULL,
	"may_affect_pricing" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "property_change_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"provider_id" uuid,
	"clerk_id" uuid,
	"inspection_type" "inspection_type" NOT NULL,
	"inspection_types" text[],
	"scheduled_date" date NOT NULL,
	"preferred_time_slot" text,
	"status" "job_status" DEFAULT 'draft' NOT NULL,
	"service_tier" text DEFAULT 'standard' NOT NULL,
	"special_instructions" text,
	"quoted_price" numeric,
	"final_price" numeric,
	"short_notice_surcharge_applied" boolean DEFAULT false NOT NULL,
	"clerk_payout" numeric DEFAULT '0',
	"clerk_bonus" numeric DEFAULT '0',
	"clerk_final_payout" numeric DEFAULT '0',
	"clerk_payout_locked" boolean DEFAULT false,
	"clerk_payment_date" timestamp with time zone,
	"clerk_level_at_job" integer DEFAULT 1,
	"clerk_payout_breakdown" jsonb DEFAULT '{}'::jsonb,
	"clerk_payout_log" jsonb DEFAULT '[]'::jsonb,
	"margin" numeric DEFAULT '0',
	"client_pre_inspection_ack" boolean DEFAULT false,
	"client_pre_inspection_ack_at" timestamp with time zone,
	"client_report_accepted" boolean DEFAULT false,
	"client_report_accepted_at" timestamp with time zone,
	"client_report_comments" text,
	"client_signature_url" text,
	"client_signature_at" timestamp with time zone,
	"clerk_report_submitted_ack" boolean DEFAULT false,
	"clerk_report_submitted_ack_at" timestamp with time zone,
	"provider_job_completed_ack" boolean DEFAULT false,
	"provider_job_completed_ack_at" timestamp with time zone,
	"tier_acknowledged_at" timestamp with time zone,
	"policy_acknowledged_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancellation_fee" numeric DEFAULT '0',
	"reschedule_requested_date" date,
	"reschedule_requested_time_slot" text,
	"reschedule_requested_at" timestamp with time zone,
	"reschedule_resolved_by" uuid,
	"reschedule_resolved_at" timestamp with time zone,
	"reschedule_status" text,
	"created_by_user_id" uuid,
	"created_by_name" text,
	"assigned_by" uuid,
	"assigned_by_name" text,
	"organisation_id" uuid,
	"inventorybase_job_id" text,
	"report_url" text,
	"review_email_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"clerk_id" uuid,
	"pdf_url" text,
	"status" text DEFAULT 'submitted',
	"admin_notes" text,
	"submitted_at" timestamp with time zone DEFAULT now(),
	"approved_at" timestamp with time zone,
	CONSTRAINT "reports_status_check" CHECK (status = ANY (ARRAY['submitted'::text, 'approved'::text, 'returned'::text, 'rejected'::text]))
);
--> statement-breakpoint
ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organisation_members" ADD CONSTRAINT "organisation_members_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_reports" ADD CONSTRAINT "inspection_reports_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_rooms" ADD CONSTRAINT "inspection_rooms_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "public"."inspection_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_items_map" ADD CONSTRAINT "inspection_items_map_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_items_map" ADD CONSTRAINT "inspection_items_map_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."inspection_rooms_map"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_items" ADD CONSTRAINT "inspection_items_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."inspection_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."inspection_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "public"."inspection_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."inspection_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_rooms_map" ADD CONSTRAINT "inspection_rooms_map_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_details" ADD CONSTRAINT "tenant_details_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_payments" ADD CONSTRAINT "escrow_payments_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_reports" ADD CONSTRAINT "generated_reports_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clerk_incidents" ADD CONSTRAINT "clerk_incidents_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_change_logs" ADD CONSTRAINT "property_change_logs_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "Users can view their own profile" ON "profiles" AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));--> statement-breakpoint
CREATE POLICY "Users can insert their own profile" ON "profiles" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "Users can update their own profile" ON "profiles" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "Admins can view all profiles" ON "profiles" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Admins can update all profiles" ON "profiles" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "Providers can view their clerks profiles" ON "profiles" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Providers can update their clerks profiles" ON "profiles" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "Users can view their own roles" ON "user_roles" AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));--> statement-breakpoint
CREATE POLICY "Users can insert their own role during onboarding" ON "user_roles" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "Admins can view all user roles" ON "user_roles" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Admins can update user roles" ON "user_roles" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "Admins can delete user roles" ON "user_roles" AS PERMISSIVE FOR DELETE TO public;--> statement-breakpoint
CREATE POLICY "Members can view org members" ON "organisation_members" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((organisation_id = get_user_org_id(auth.uid())));--> statement-breakpoint
CREATE POLICY "Owners can insert org members" ON "organisation_members" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "Owners can update org members" ON "organisation_members" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "Users can insert themselves as owner" ON "organisation_members" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "Admins can manage all org members" ON "organisation_members" AS PERMISSIVE FOR ALL TO "authenticated";--> statement-breakpoint
CREATE POLICY "Members can view their own organisation" ON "organisations" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((id = get_user_org_id(auth.uid())));--> statement-breakpoint
CREATE POLICY "Clients can create organisations" ON "organisations" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "Owners can update their organisation" ON "organisations" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "Admins can view all organisations" ON "organisations" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "Clients can view their own properties" ON "properties" AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = client_id));--> statement-breakpoint
CREATE POLICY "Clients can insert their own properties" ON "properties" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "Clients can update their own properties" ON "properties" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "Clients can delete their own properties" ON "properties" AS PERMISSIVE FOR DELETE TO public;--> statement-breakpoint
CREATE POLICY "Clerks can view properties for their jobs" ON "properties" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Org members can view org properties" ON "properties" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "Org members can insert org properties" ON "properties" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "Org members can update org properties" ON "properties" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "Clerks can insert their own reports" ON "inspection_reports" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = clerk_id));--> statement-breakpoint
CREATE POLICY "Clerks can update their own reports" ON "inspection_reports" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "Clerks can view their own reports" ON "inspection_reports" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Clients can view reports for their jobs" ON "inspection_reports" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Admins can view all reports" ON "inspection_reports" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Clerks can manage rooms in their reports" ON "inspection_rooms" AS PERMISSIVE FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM inspection_reports
  WHERE ((inspection_reports.id = inspection_rooms.report_id) AND (inspection_reports.clerk_id = auth.uid())))));--> statement-breakpoint
CREATE POLICY "Clients can view rooms for their jobs" ON "inspection_rooms" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Admins can manage all mapped items" ON "inspection_items_map" AS PERMISSIVE FOR ALL TO public USING (has_role(auth.uid(), 'admin'::app_role));--> statement-breakpoint
CREATE POLICY "Clerks can manage items for their jobs" ON "inspection_items_map" AS PERMISSIVE FOR ALL TO public;--> statement-breakpoint
CREATE POLICY "Clients can view items for their jobs" ON "inspection_items_map" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Clerks can manage items in their reports" ON "inspection_items" AS PERMISSIVE FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM (inspection_rooms r
     JOIN inspection_reports ir ON ((ir.id = r.report_id)))
  WHERE ((r.id = inspection_items.room_id) AND (ir.clerk_id = auth.uid())))));--> statement-breakpoint
CREATE POLICY "Clients can view items for their jobs" ON "inspection_items" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Clerks can manage photos in their reports" ON "inspection_photos" AS PERMISSIVE FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM inspection_reports
  WHERE ((inspection_reports.id = inspection_photos.report_id) AND (inspection_reports.clerk_id = auth.uid())))));--> statement-breakpoint
CREATE POLICY "Clients can view photos for their jobs" ON "inspection_photos" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Admins can manage all tenant details" ON "tenant_details" AS PERMISSIVE FOR ALL TO public USING (has_role(auth.uid(), 'admin'::app_role));--> statement-breakpoint
CREATE POLICY "Clerks can view tenant details for their jobs" ON "tenant_details" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Clients can view tenant details for their jobs" ON "tenant_details" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Clients can insert tenant details for their jobs" ON "tenant_details" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "Clients can update tenant details for their jobs" ON "tenant_details" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "Org members can view org tenant details" ON "tenant_details" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "Org members can insert org tenant details" ON "tenant_details" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "Org members can update org tenant details" ON "tenant_details" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "Providers can view their own escrow payments" ON "escrow_payments" AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = provider_id));--> statement-breakpoint
CREATE POLICY "System can insert escrow payments" ON "escrow_payments" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "Admins can view all escrow payments" ON "escrow_payments" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Clients can view their own escrow payments" ON "escrow_payments" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Clients can update their escrow payments" ON "escrow_payments" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "Clerks can view their own escrow payments" ON "escrow_payments" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Users can view their own messages" ON "messages" AS PERMISSIVE FOR SELECT TO public USING (((auth.uid() = sender_id) OR (auth.uid() = recipient_id)));--> statement-breakpoint
CREATE POLICY "Users can send messages" ON "messages" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "Recipients can mark messages as read" ON "messages" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "Admins can view all messages" ON "messages" AS PERMISSIVE FOR ALL TO public;--> statement-breakpoint
CREATE POLICY "Admins can manage all item photos" ON "inspection_item_photos" AS PERMISSIVE FOR ALL TO public USING (has_role(auth.uid(), 'admin'::app_role));--> statement-breakpoint
CREATE POLICY "Clerks can manage photos for their jobs" ON "inspection_item_photos" AS PERMISSIVE FOR ALL TO public;--> statement-breakpoint
CREATE POLICY "Clients can view photos for their jobs" ON "inspection_item_photos" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Admins can manage all generated reports" ON "generated_reports" AS PERMISSIVE FOR ALL TO public USING (has_role(auth.uid(), 'admin'::app_role));--> statement-breakpoint
CREATE POLICY "Clerks can manage reports for their jobs" ON "generated_reports" AS PERMISSIVE FOR ALL TO public;--> statement-breakpoint
CREATE POLICY "Clients can view reports for their jobs" ON "generated_reports" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Anyone authenticated can view reviews" ON "reviews" AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() IS NOT NULL));--> statement-breakpoint
CREATE POLICY "Users can view reviews they're involved in" ON "reviews" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Reviewers can insert their own reviews" ON "reviews" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "Reviewees can update clerk_response only" ON "reviews" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "Admins can manage all reviews" ON "reviews" AS PERMISSIVE FOR ALL TO public;--> statement-breakpoint
CREATE POLICY "Users can view their own notifications" ON "notifications" AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));--> statement-breakpoint
CREATE POLICY "Users can update their own notifications" ON "notifications" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "Admins can manage all notifications" ON "notifications" AS PERMISSIVE FOR ALL TO public;--> statement-breakpoint
CREATE POLICY "Admins can insert notifications" ON "notifications" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "Users can view their own preferences" ON "notification_preferences" AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));--> statement-breakpoint
CREATE POLICY "Users can insert their own preferences" ON "notification_preferences" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "Users can update their own preferences" ON "notification_preferences" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "Clerks can view their own incidents" ON "clerk_incidents" AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = clerk_id));--> statement-breakpoint
CREATE POLICY "Admins can manage all clerk incidents" ON "clerk_incidents" AS PERMISSIVE FOR ALL TO public;--> statement-breakpoint
CREATE POLICY "Users can view their own disputes" ON "disputes" AS PERMISSIVE FOR SELECT TO public USING (((auth.uid() = raised_by) OR (auth.uid() = raised_against)));--> statement-breakpoint
CREATE POLICY "Users can create disputes" ON "disputes" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "Admins can manage all disputes" ON "disputes" AS PERMISSIVE FOR ALL TO public;--> statement-breakpoint
CREATE POLICY "Clerks can view their own strikes" ON "strikes" AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = clerk_id));--> statement-breakpoint
CREATE POLICY "Admins can manage all strikes" ON "strikes" AS PERMISSIVE FOR ALL TO public;--> statement-breakpoint
CREATE POLICY "Anyone can submit waitlist lead" ON "waitlist_leads" AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "Admins can manage waitlist leads" ON "waitlist_leads" AS PERMISSIVE FOR ALL TO public;--> statement-breakpoint
CREATE POLICY "Users can insert their own xero connections" ON "xero_connections" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));--> statement-breakpoint
CREATE POLICY "Users can update their own xero connections" ON "xero_connections" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "Users can delete their own xero connections" ON "xero_connections" AS PERMISSIVE FOR DELETE TO public;--> statement-breakpoint
CREATE POLICY "Admins can view all invitations" ON "clerk_invitations" AS PERMISSIVE FOR SELECT TO public USING (has_role(auth.uid(), 'admin'::app_role));--> statement-breakpoint
CREATE POLICY "Providers can view their invitations" ON "clerk_invitations" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Providers can create invitations" ON "clerk_invitations" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "Providers can update their invitations" ON "clerk_invitations" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "Users can accept invitations" ON "clerk_invitations" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "Admins can view all email logs" ON "email_logs" AS PERMISSIVE FOR SELECT TO public USING (has_role(auth.uid(), 'admin'::app_role));--> statement-breakpoint
CREATE POLICY "Anyone can read platform settings" ON "platform_settings" AS PERMISSIVE FOR SELECT TO public USING (true);--> statement-breakpoint
CREATE POLICY "Admins can manage platform settings" ON "platform_settings" AS PERMISSIVE FOR ALL TO public;--> statement-breakpoint
CREATE POLICY "Admins can view all change logs" ON "property_change_logs" AS PERMISSIVE FOR SELECT TO public USING (has_role(auth.uid(), 'admin'::app_role));--> statement-breakpoint
CREATE POLICY "Clients can view change logs for their properties" ON "property_change_logs" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Clients can insert change logs for their properties" ON "property_change_logs" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "Clerks can view change logs for their job properties" ON "property_change_logs" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Org members can view org property change logs" ON "property_change_logs" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "Clients can view their own jobs" ON "jobs" AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = client_id));--> statement-breakpoint
CREATE POLICY "Clients can insert their own jobs" ON "jobs" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "Clients can update their own jobs" ON "jobs" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "Clerks can view their assigned jobs" ON "jobs" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Clerks can update their assigned jobs" ON "jobs" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "Clerks can view published jobs" ON "jobs" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Providers can view their jobs" ON "jobs" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Providers can update their jobs" ON "jobs" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "Admins can manage all jobs" ON "jobs" AS PERMISSIVE FOR ALL TO public;--> statement-breakpoint
CREATE POLICY "Org members can view org jobs" ON "jobs" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "Org members can insert org jobs" ON "jobs" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "Org members can update org jobs" ON "jobs" AS PERMISSIVE FOR UPDATE TO "authenticated";
*/