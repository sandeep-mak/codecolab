/**
 * Central API configuration.
 * In production (Render), VITE_API_BASE_URL is set as an environment variable.
 * Locally it falls back to localhost:8080.
 */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '${API_BASE_URL || API_BASE_URL}';
export const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL ||
    (import.meta.env.VITE_API_BASE_URL
        ? import.meta.env.VITE_API_BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://')
        : 'ws://localhost:8080');
