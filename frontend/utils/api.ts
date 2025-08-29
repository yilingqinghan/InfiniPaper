const base = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

export async function apiGet(path: string) {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed`);
  return res.json();
}

export async function apiPost(path: string, body: any) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed`);
  return res.json();
}