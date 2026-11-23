import { z } from "zod";

export const SERVICES = [
  "user-microservice",
  "wall-microservice",
  "booking-microservice",
  "gate-microservice",
  "billing-microservice",
  "contact-microservice",
] as const;

export type ServiceName = (typeof SERVICES)[number];

export const ROLES = ["ADMINISTRACION", "VIGILANTE", "RESIDENTE"] as const;

const audienceSchema = z
  .object({
    roles: z.array(z.enum(ROLES)).optional(),
    userIds: z.array(z.number().int().positive()).optional(),
  })
  .refine((audience) => Boolean(audience.roles?.length || audience.userIds?.length), {
    message: "La audiencia debe indicar roles o usuarios.",
  });

export const requestFrameSchema = z.object({
  type: z.literal("request"),
  id: z.string().min(1).max(100),
  target: z.enum(SERVICES),
  action: z.string().min(1).max(100),
  payload: z.unknown().optional(),
});

export const responseFrameSchema = z.object({
  type: z.literal("response"),
  id: z.string().min(1).max(100),
  ok: z.boolean(),
  payload: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

export const eventFrameSchema = z.object({
  type: z.literal("event"),
  name: z.string().min(1).max(100),
  audience: audienceSchema,
  payload: z.unknown().optional(),
});

export const frameSchema = z.discriminatedUnion("type", [requestFrameSchema, responseFrameSchema, eventFrameSchema]);

export type RequestFrame = z.infer<typeof requestFrameSchema>;
export type ResponseFrame = z.infer<typeof responseFrameSchema>;
export type EventFrame = z.infer<typeof eventFrameSchema>;

export function isServiceName(value: unknown): value is ServiceName {
  return SERVICES.some((service) => service === value);
}
