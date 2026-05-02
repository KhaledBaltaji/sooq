// Auth.js v5 configuration for Sooq Speed.
//
// Two providers:
//   - Google OAuth (via @auth/core/providers/google)
//   - WhatsApp OTP (custom Credentials provider, VerifyWay backend)
//
// Sessions live in the Postgres `sessions` table (Drizzle adapter).
// Each Next.js API route reads the session, extracts user_id, and sets
// the `app.user_id` Postgres GUC for the connection so RPCs can read it
// (W6 swap from `auth.uid()`).
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
  session: { strategy: "database" },
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
    async session({ session, user }) {
      // Surface our extra columns onto the session for client convenience.
      // Frontend can read session.user.balance_usd / phone / etc.
      if (user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
