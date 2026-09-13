/**
 * Configuration from the environment, with argv as an override.
 *
 *     CINO_TOKEN=cino_svc_… CINO_TIMELINE=<uuid> npm start -w @starling/integration-test
 *     node src/index.ts --timeline <uuid> --url http://localhost:3000
 *
 * The URL defaults to production, https://cino.no.
 */

export interface Config {
  baseUrl: string;
  token: string;
  timelineId: string;
}

export class ConfigError extends Error {}

/** Reads `--name value` pairs; later flags win, which is what a shell user expects. */
export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) continue;
    out[arg.slice(2)] = next;
    i++;
  }
  return out;
}

export function resolveConfig(
  env: Record<string, string | undefined>,
  argv: string[] = [],
): Config {
  const args = parseArgs(argv);

  const rawUrl     = args.url      ?? env.CINO_URL      ?? 'https://cino.no';
  const token      = args.token    ?? env.CINO_TOKEN    ?? '';
  const timelineId = args.timeline ?? env.CINO_TIMELINE ?? '';

  if (!token) {
    throw new ConfigError(
      'No API token. Pass --token or set CINO_TOKEN.\n'
      + 'Create one in the production settings under Integrations.',
    );
  }
  if (!timelineId) {
    throw new ConfigError('No timeline. Pass --timeline <id> or set CINO_TIMELINE.');
  }
  // Caught here rather than as an opaque 401 twenty lines later.
  if (!/^cino_svc_[0-9a-f]{32}_/.test(token)) {
    throw new ConfigError('That does not look like a Cino API token — expected cino_svc_…');
  }

  // The same origin serves REST and the socket, and fetch() only speaks http(s).
  // A ws(s):// URL is accepted as the natural thing to type and mapped back;
  // socket.io picks the socket scheme itself.
  if (!/^(https?|wss?):\/\//.test(rawUrl)) {
    throw new ConfigError(`Invalid URL "${rawUrl}" — expected https://host or http://host:port`);
  }
  const baseUrl = rawUrl.replace(/^ws(s?):\/\//, 'http$1://');

  // Trailing slashes turn every URL into a double slash, which some proxies
  // treat as a different path.
  return { baseUrl: baseUrl.replace(/\/+$/, ''), token, timelineId };
}
