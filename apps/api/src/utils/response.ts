export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ message, Object: "error" }, status);
}

/** Converts one handler operation into the route's established error format. */
export async function withErrorResponse<T>(
  operation: () => Promise<T>,
  fallback: string,
  status = 500,
): Promise<T | Response> {
  try {
    return await operation();
  } catch (error: unknown) {
    return errorResponse(
      error instanceof Error && error.message ? error.message : fallback,
      status,
    );
  }
}

/** OAuth2 / Identity server error format expected by Bitwarden clients */
export function identityErrorResponse(
  message: string,
  error = "invalid_grant",
  status = 400,
): Response {
  return jsonResponse(
    {
      error,
      error_description: message,
      ErrorModel: { Message: message, Object: "error" },
    },
    status,
  );
}
