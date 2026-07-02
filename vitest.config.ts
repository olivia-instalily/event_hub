import { defineConfig } from "vitest/config";

// Integration tests run against the LOCAL Supabase stack (supabase start). They read
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from .env.local, the same as the app.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
