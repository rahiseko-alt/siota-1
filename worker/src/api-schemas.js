import { z } from 'zod';

export const uuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
);

export const createOwnerSchema = z.object({
  name: z.string().trim().min(1).max(120),
}).strict();

export const updateOwnerSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  active: z.boolean().optional(),
}).strict().refine((value) => value.name !== undefined || value.active !== undefined);

export const createPetSchema = z.object({
  ownerId: uuidSchema,
  name: z.string().trim().min(1).max(120),
  template: z.string().trim().min(1).max(50),
}).strict();

export const updatePetSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  template: z.string().trim().min(1).max(50).optional(),
  active: z.boolean().optional(),
}).strict().refine((value) => (
  value.name !== undefined || value.template !== undefined || value.active !== undefined
));

export const createReportSchema = z.object({
  petId: uuidSchema,
  reportDate: z.iso.date(),
  data: z.record(z.string(), z.unknown()),
}).strict();

export const updateReportSchema = z.object({
  data: z.record(z.string(), z.unknown()),
}).strict();

export const createReportAssetSchema = z.object({
  id: uuidSchema,
  kind: z.string().trim().min(1).max(40),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  byteSize: z.number().int().min(1).max(10 * 1024 * 1024),
  sortOrder: z.number().int().min(0).max(10_000),
}).strict();

export const createInvitationSchema = z.discriminatedUnion('invitationType', [
  z.object({ invitationType: z.literal('owner'), ownerId: uuidSchema }).strict(),
  z.object({ invitationType: z.literal('staff'), staffRole: z.enum(['admin', 'staff']) }).strict(),
]);

export const claimInvitationSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/i),
}).strict();

export const updateMembershipSchema = z.object({
  role: z.enum(['admin', 'staff']).optional(),
  active: z.boolean().optional(),
}).strict().refine((value) => value.role !== undefined || value.active !== undefined);

export async function parseJson(request, schema, maxBytes = 1_048_576) {
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, status: 413, error: 'request too large' };
  }
  let raw;
  let body;
  try {
    raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > maxBytes) {
      return { ok: false, status: 413, error: 'request too large' };
    }
    body = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, error: 'invalid json' };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: 'invalid request' };
  return { ok: true, data: parsed.data };
}
