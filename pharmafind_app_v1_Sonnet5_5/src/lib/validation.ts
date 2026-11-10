import type { ZodType, ZodTypeDef } from "zod";
import { AppError } from "./errors";

/** Parses `data` with a zod schema and converts failures into a VALIDATION_ERROR AppError. */
export function parseInput<T>(schema: ZodType<T, ZodTypeDef, unknown>, data: unknown, message = "Invalid input"): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const details = result.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
  const first = details[0];
  throw new AppError("VALIDATION_ERROR", first ? `${message}: ${first.field ? first.field + " - " : ""}${first.message}` : message, details);
}
