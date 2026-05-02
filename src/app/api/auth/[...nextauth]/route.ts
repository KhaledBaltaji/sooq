// Auth.js v5 catch-all route handler.
// Handles: /api/auth/signin, /api/auth/signout, /api/auth/session,
//          /api/auth/csrf, /api/auth/providers, /api/auth/callback/<provider>

import { handlers } from "@/auth";

export const { GET, POST } = handlers;
