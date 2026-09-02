import { config } from "dotenv"
import { defineConfig } from "drizzle-kit"

config({ path: [".env.local", ".env"], quiet: true })

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run drizzle-kit. Copy .env.example to .env.local.")
}

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
  schemaFilter: ["public"],
  strict: true,
  verbose: true,
})
