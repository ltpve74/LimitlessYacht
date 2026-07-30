/**
 * Process env — never import this from pure domain tests without mocking.
 */
export function getDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL;
}

export function requireDatabaseUrl(): string {
  const url = getDatabaseUrl();
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Create a Neon project and copy the URL into tracker-v2/.env — see README.md"
    );
  }
  return url;
}
