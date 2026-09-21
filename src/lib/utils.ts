import { clsx } from 'clsx'
import type { ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Tailwind-aware class merge. Later classes win over earlier conflicting ones. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** `1843.2` → `1.8k`. Keeps dashboard tiles from wrapping. */
export function formatCompact(value: number, digits = 1): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(digits)}B`
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(digits)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(digits)}k`
  return value.toFixed(abs < 10 && !Number.isInteger(value) ? digits : 0)
}

/** Fixed decimals with thousands separators. */
export function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/** `0.0031` → `0.31%`. Small rates get more precision so they are not all `0.00%`. */
export function formatPercent(value: number, digits?: number): string {
  const places = digits ?? (value > 0 && value < 0.01 ? 3 : 2)
  return `${(value * 100).toFixed(places)}%`
}

/** Latency, with the unit chosen so the number stays readable. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—'
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`
  if (ms < 1000) return `${ms < 10 ? ms.toFixed(1) : Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

/** Relative time from an ISO string or epoch ms. */
export function formatRelative(input: string | number, now = Date.now()): string {
  const then = typeof input === 'string' ? new Date(input).getTime() : input
  const seconds = Math.round((now - then) / 1000)

  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

/** Absolute clock time, for log and span detail rows. */
export function formatClock(input: string | number): string {
  const date = typeof input === 'string' ? new Date(input) : new Date(input)
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function formatTimestamp(input: string | number): string {
  const date = typeof input === 'string' ? new Date(input) : new Date(input)
  return date.toLocaleString('en-US', {
    hour12: false,
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Shorten `4bf92f3577b34da6a3ce929d0e0e4736` for display in dense tables. */
export function shortId(id: string, length = 8): string {
  return id.length <= length ? id : id.slice(0, length)
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`)
}

/** Clamp to [0, 1]; used for saturation and budget bars. */
export function ratio(value: number): number {
  return Math.min(1, Math.max(0, value))
}
