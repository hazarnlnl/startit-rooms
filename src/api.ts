import type { Booking } from "./rooms";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json" } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Something went wrong. Try again.");
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  list: (date: string) => call<Booking[]>(`/api/bookings?date=${date}`),
  create: (b: Omit<Booking, "id"> & { id?: string }) => call<Booking>("/api/bookings", { method: "POST", body: JSON.stringify(b) }),
  update: (id: string, patch: Partial<Booking>) => call<Booking>(`/api/bookings/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  remove: (id: string) => call<void>(`/api/bookings/${id}`, { method: "DELETE" }),
};
