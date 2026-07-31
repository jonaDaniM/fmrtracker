/**
 * AdminService.gs
 *
 * Reserved for future Admin write services that do not belong to a more
 * specific domain service.
 *
 * Current Admin responsibilities:
 * - Admin dashboard reads and operational queues:
 *   AdminPortalDataService.gs
 *
 * - Planning backorder decisions:
 *   BackorderService.gs
 *
 * - Portal identity and capability bootstrap:
 *   PortalService.gs
 *
 * - Shared header and material serialization:
 *   SerializationService.gs
 *
 * - Field reads and Field material transactions:
 *   FieldService.gs
 *
 * This file is intentionally comment-only.
 *
 * Keeping this file free of executable functions ensures that the Apps Script
 * project contains exactly one global definition of reviewBackorder_() and
 * avoids duplicating responsibilities already assigned to other services.
 */