/**
 * Ingestion time windows for pull connectors (CLI: --period / --past / --future).
 * Months use 30-day units (same as legacy ±30d calendar default).
 */

export interface IngestWindow {
  /** How far back to pull mail, calendar history, and completed Asana work */
  pastDays: number;
  /** How far ahead for calendar (and Asana due dates) */
  futureDays: number;
}

export const DEFAULT_INGEST_WINDOW: IngestWindow = {
  pastDays: 30,
  futureDays: 30,
};

export const MAX_INGEST_PAST_DAYS = 365;
export const MAX_INGEST_FUTURE_DAYS = 365;

const DURATION_RE = /^(\d+)\s*(d|day|days|w|week|weeks|m|month|months)$/i;

/** Parse `7d`, `2w`, `1m`, `14 days`, `2 weeks`, `1 month` → whole days */
export function parseDurationToDays(input: string): number {
  const trimmed = input.trim().toLowerCase();
  const m = DURATION_RE.exec(trimmed);
  if (!m) {
    throw new Error(
      `Invalid duration "${input}". Use forms like 7d, 2w, 1m, 14 days, 2 weeks, 1 month.`
    );
  }
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`Duration must be at least 1: "${input}"`);
  }
  const unit = m[2]!;
  if (unit.startsWith("d")) return n;
  if (unit.startsWith("w")) return n * 7;
  return n * 30; // month
}

function clampDays(value: number, max: number, label: string): number {
  if (value > max) {
    throw new Error(`${label} exceeds maximum of ${max} days (${value} requested).`);
  }
  return value;
}

export function formatIngestWindow(window: IngestWindow): string {
  return `past ${window.pastDays}d, future ${window.futureDays}d (calendar)`;
}

export interface ParseIngestArgvResult {
  window: IngestWindow;
  connectorFilter?: string;
}

function argValue(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1) return undefined;
  const value = argv[idx + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

/** Parse ingest CLI flags from process.argv (after tsx script name). */
export function parseIngestArgv(argv: string[]): ParseIngestArgvResult {
  const args = argv.filter((a) => a !== "--");
  const window: IngestWindow = { ...DEFAULT_INGEST_WINDOW };

  const period = argValue(args, "--period") ?? argValue(args, "--window");
  const past = argValue(args, "--past") ?? argValue(args, "--since");
  const future = argValue(args, "--future");

  if (period) {
    const days = parseDurationToDays(period);
    window.pastDays = days;
    window.futureDays = days;
  }
  if (past) {
    window.pastDays = parseDurationToDays(past);
  }
  if (future) {
    window.futureDays = parseDurationToDays(future);
  }

  window.pastDays = clampDays(window.pastDays, MAX_INGEST_PAST_DAYS, "Past window");
  window.futureDays = clampDays(window.futureDays, MAX_INGEST_FUTURE_DAYS, "Future window");

  const connectorFilter = argValue(args, "--connector");

  return {
    window,
    ...(connectorFilter ? { connectorFilter } : {}),
  };
}

export const INGEST_CLI_USAGE =
  'Usage: pnpm ingest [--connector gcal|gmail|asana|mscal|msmail] [--period 7d|2w|1m] [--past 30d] [--future 14d]';
