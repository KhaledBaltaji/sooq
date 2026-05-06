// Auth.js v5 configuration for Sooq Speed.
//
// Two providers:
//   - Google OAuth (via @auth/core/providers/google)
//   - WhatsApp OTP (custom Credentials provider, VerifyWay backend)
//
// Sessions: signed JWTs stored in HttpOnly cookies. Auth.js v5 does not
// support the database session strategy with Credentials providers
// (documented limitation — Credentials sign-ins do not create accounts
// rows, which the database adapter requires for session attachment),
// so all sessions are JWT-backed. The Drizzle adapter is still wired up
// to manage `users`, `accounts`, and `verificationTokens` for OAuth
// account linking + user persistence; it just does not own session rows.
//
// Each Next.js API route reads the session via auth(), extracts user_id
// from session.user.id (set by the session callback below from token.id),
// and sets the `app.user_id` Postgres GUC for the connection via
// runAs(userId, fn) so RPCs can read it (W6 swap from `auth.uid()`).
// The GUC pattern works identically under JWT and database strategies —
// only the transport for session.user.id changes.
//
// Env vars (in .env.local for dev, Vercel env for staging/prod):
//   - AUTH_SECRET (32-byte random; openssl rand -base64 32)
//   - AUTH_GOOGLE_ID (Google OAuth client ID)
//   - AUTH_GOOGLE_SECRET (Google OAuth client secret)
//   - AUTH_TRUST_HOST=true (only required for Vercel preview / staging deploys)
//   - DATABASE_URL (Postgres connection string)

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/lib/db";
import {
  users,
  accounts,
  sessions,
  verificationTokens,
} from "@/lib/db/schema";
import { whatsappOtpProvider } from "@/lib/auth/whatsapp-otp-provider";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "jwt" },
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      // Force re-consent so user always sees the account picker
      authorization: { params: { prompt: "select_account" } },
    }),
    whatsappOtpProvider,
  ],
  callbacks: {
    async jwt({ token, user }) {
      // First sign-in: copy the database user.id onto the JWT so subsequent
      // requests can read it from the token without a DB hit. On later
      // requests `user` is undefined and we leave the token as-is.
      if (user?.id) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      // JWT strategy: token.id is the source of truth for user.id (set in
      // the jwt callback above on first sign-in). Surface it onto session.user
      // so the W6 GUC pattern (runAs(session.user.id, ...)) keeps working
      // identically to the prior database strategy.
      if (session.user && typeof token.id === "string") {
        session.user.id = token.id;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
