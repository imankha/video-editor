export default function apiFetch(url, options = {}) {
  return fetch(url, { credentials: 'include', ...options });
}
