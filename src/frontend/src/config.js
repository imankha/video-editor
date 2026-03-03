/**
 * Application configuration
 *
 * API_BASE: The base URL for API calls
 * - Dev: empty string — Vite's proxy forwards /api/* to localhost backend
 * - Staging/Prod: set VITE_API_BASE at build time to the backend URL
 *
 * Usage:
 *   import { API_BASE } from './config';
 *   fetch(`${API_BASE}/api/health`)
 */
export const API_BASE = import.meta.env.VITE_API_BASE || '';
