/**
 * Application configuration
 *
 * API_BASE: The base URL for API calls
 * - Set to empty string so all API calls use relative URLs (e.g., /api/health)
 * - Vite's proxy configuration handles routing to the correct backend port
 * - This allows E2E tests to use a different backend port without code changes
 *
 * Usage:
 *   import { API_BASE } from './config';
 *   fetch(`${API_BASE}/api/health`)  // becomes fetch('/api/health')
 */

// Use empty string - all API calls go through Vite's proxy
// The proxy is configured in vite.config.js to forward to the correct backend port
export const API_BASE = '';
