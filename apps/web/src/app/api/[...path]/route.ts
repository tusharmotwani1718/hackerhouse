// Unknown /api/* paths → JSON 404 in the error envelope (instead of Next's HTML page).
// More specific routes always win, so this never shadows a real endpoint.
import { AppError } from "@/server/core/errors";
import { route } from "@/server/core/route";

const notFound = route(async (req: Request) => {
  throw new AppError("NOT_FOUND", `No endpoint ${req.method} ${new URL(req.url).pathname}.`);
});

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
