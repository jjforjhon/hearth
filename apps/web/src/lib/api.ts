/** Minimal typed fetch wrapper. Errors arrive as { error: string }. */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* keep default */
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

export const api = {
  get<T>(url: string): Promise<T> {
    return fetch(url, { credentials: "include" }).then((r) => handle<T>(r));
  },
  post<T>(url: string, body?: unknown): Promise<T> {
    return fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: body === undefined ? "{}" : JSON.stringify(body),
    }).then((r) => handle<T>(r));
  },
  patch<T>(url: string, body: unknown): Promise<T> {
    return fetch(url, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => handle<T>(r));
  },
  del<T>(url: string): Promise<T> {
    return fetch(url, { method: "DELETE", credentials: "include" }).then((r) => handle<T>(r));
  },
  async putBody<T>(url: string, blob: Blob | BufferSource): Promise<T> {
    return fetch(url, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/octet-stream" },
      body: blob as Blob,
    }).then((r) => handle<T>(r));
  },
};
