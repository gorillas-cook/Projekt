// Demo-only identity: replace with your real login. The server ignores this header in production.
export function userId() {
  let id = localStorage.getItem('demoUserId');
  if (!id) {
    id = prompt('Демо-ID пользователя (например, seller-1 или buyer-1)') || 'demo-user';
    localStorage.setItem('demoUserId', id);
  }
  return id;
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Demo-User-Id': userId() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
