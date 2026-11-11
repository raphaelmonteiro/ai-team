// ai-team dashboard version: date of the release it was copied from (install.sh copies this file with the rest).
// Shown by `server.mjs --version`, at startup and in GET /api/health, so an installed copy can be told from the clone's.
export const VERSION = '2026.11.11';
// the conf version this copy understands (lib/migrate.sh AI_TEAM_CONF_VERSION_CURRENT); a conf ahead of it means
// the installed dashboard is older than the source that wrote the conf: run install.sh
export const CONF_VERSION = 2;
