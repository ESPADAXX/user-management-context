// Thin client for the contract in context/contracts/openapi.yaml.
let token = sessionStorage.getItem('token');

export const getToken = () => token;
export function setToken(t) {
  token = t;
  if (t) sessionStorage.setItem('token', t);
  else sessionStorage.removeItem('token');
}

export class ApiError extends Error {
  constructor(problem) {
    super(problem.detail || problem.title);
    this.status = problem.status;
    this.errors = problem.errors || [];
  }
}

export async function api(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token && path !== '/auth/login') { setToken(null); window.dispatchEvent(new Event('signed-out')); }
    throw new ApiError({ status: res.status, ...data });
  }
  return data;
}
