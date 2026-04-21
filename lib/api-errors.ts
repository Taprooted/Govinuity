export function internalServerError(error: unknown, message = "Internal server error") {
  console.error(error);
  return Response.json({ error: message }, { status: 500 });
}
