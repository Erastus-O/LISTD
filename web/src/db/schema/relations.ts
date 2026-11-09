import { relations } from "drizzle-orm/relations";
import { organisations, organisationMembers, jobs, inspectionReports, inspectionRooms, inspectionItemsMap, inspectionRoomsMap, inspectionItems, inspectionPhotos, tenantDetails, escrowPayments, messages, generatedReports, reviews, clerkIncidents, disputes, properties, propertyChangeLogs, upsellNotificationsSent } from "./schema";

export const organisationMembersRelations = relations(organisationMembers, ({one}) => ({
	organisation: one(organisations, {
		fields: [organisationMembers.organisationId],
		references: [organisations.id]
	}),
}));

export const organisationsRelations = relations(organisations, ({many}) => ({
	organisationMembers: many(organisationMembers),
}));

export const inspectionReportsRelations = relations(inspectionReports, ({one, many}) => ({
	job: one(jobs, {
		fields: [inspectionReports.jobId],
		references: [jobs.id]
	}),
	inspectionRooms: many(inspectionRooms),
	inspectionPhotos: many(inspectionPhotos),
}));

export const jobsRelations = relations(jobs, ({one, many}) => ({
	inspectionReports: many(inspectionReports),
	inspectionItemsMaps: many(inspectionItemsMap),
	inspectionRoomsMaps: many(inspectionRoomsMap),
	tenantDetails: many(tenantDetails),
	escrowPayments: many(escrowPayments),
	messages: many(messages),
	generatedReports: many(generatedReports),
	reviews: many(reviews),
	clerkIncidents: many(clerkIncidents),
	disputes: many(disputes),
	upsellNotificationsSents: many(upsellNotificationsSent),
	property: one(properties, {
		fields: [jobs.propertyId],
		references: [properties.id]
	}),
}));

export const inspectionRoomsRelations = relations(inspectionRooms, ({one, many}) => ({
	inspectionReport: one(inspectionReports, {
		fields: [inspectionRooms.reportId],
		references: [inspectionReports.id]
	}),
	inspectionItems: many(inspectionItems),
	inspectionPhotos: many(inspectionPhotos),
}));

export const inspectionItemsMapRelations = relations(inspectionItemsMap, ({one}) => ({
	job: one(jobs, {
		fields: [inspectionItemsMap.jobId],
		references: [jobs.id]
	}),
	inspectionRoomsMap: one(inspectionRoomsMap, {
		fields: [inspectionItemsMap.roomId],
		references: [inspectionRoomsMap.id]
	}),
}));

export const inspectionRoomsMapRelations = relations(inspectionRoomsMap, ({one, many}) => ({
	inspectionItemsMaps: many(inspectionItemsMap),
	job: one(jobs, {
		fields: [inspectionRoomsMap.jobId],
		references: [jobs.id]
	}),
}));

export const inspectionItemsRelations = relations(inspectionItems, ({one, many}) => ({
	inspectionRoom: one(inspectionRooms, {
		fields: [inspectionItems.roomId],
		references: [inspectionRooms.id]
	}),
	inspectionPhotos: many(inspectionPhotos),
}));

export const inspectionPhotosRelations = relations(inspectionPhotos, ({one}) => ({
	inspectionItem: one(inspectionItems, {
		fields: [inspectionPhotos.itemId],
		references: [inspectionItems.id]
	}),
	inspectionReport: one(inspectionReports, {
		fields: [inspectionPhotos.reportId],
		references: [inspectionReports.id]
	}),
	inspectionRoom: one(inspectionRooms, {
		fields: [inspectionPhotos.roomId],
		references: [inspectionRooms.id]
	}),
}));

export const tenantDetailsRelations = relations(tenantDetails, ({one}) => ({
	job: one(jobs, {
		fields: [tenantDetails.jobId],
		references: [jobs.id]
	}),
}));

export const escrowPaymentsRelations = relations(escrowPayments, ({one}) => ({
	job: one(jobs, {
		fields: [escrowPayments.jobId],
		references: [jobs.id]
	}),
}));

export const messagesRelations = relations(messages, ({one}) => ({
	job: one(jobs, {
		fields: [messages.jobId],
		references: [jobs.id]
	}),
}));

export const generatedReportsRelations = relations(generatedReports, ({one}) => ({
	job: one(jobs, {
		fields: [generatedReports.jobId],
		references: [jobs.id]
	}),
}));

export const reviewsRelations = relations(reviews, ({one}) => ({
	job: one(jobs, {
		fields: [reviews.jobId],
		references: [jobs.id]
	}),
}));

export const clerkIncidentsRelations = relations(clerkIncidents, ({one}) => ({
	job: one(jobs, {
		fields: [clerkIncidents.jobId],
		references: [jobs.id]
	}),
}));

export const disputesRelations = relations(disputes, ({one}) => ({
	job: one(jobs, {
		fields: [disputes.jobId],
		references: [jobs.id]
	}),
}));

export const propertyChangeLogsRelations = relations(propertyChangeLogs, ({one}) => ({
	property: one(properties, {
		fields: [propertyChangeLogs.propertyId],
		references: [properties.id]
	}),
}));

export const propertiesRelations = relations(properties, ({many}) => ({
	propertyChangeLogs: many(propertyChangeLogs),
	jobs: many(jobs),
}));

export const upsellNotificationsSentRelations = relations(upsellNotificationsSent, ({one}) => ({
	job: one(jobs, {
		fields: [upsellNotificationsSent.jobId],
		references: [jobs.id]
	}),
}));