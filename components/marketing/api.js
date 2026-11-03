// The one way the marketing tools talk to the Hub. JSON in and out; a refusal
// keeps its whole body, because a save conflict carries the other person's version.
export class ApiError extends Error {
  constructor(code, message, status, data = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

export async function api(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(`/api/${path}`, {
      method, credentials: "same-origin", cache: "no-store",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("offline", "Can't reach the Hub.", 0);
  }
  const data = await response.json().catch(() => null);
  if (!data) throw new ApiError("bad_response", `The Hub answered ${response.status}.`, response.status);
  if (!data.ok) throw new ApiError(data.code, data.message || data.code, response.status, data);
  return data;
}
