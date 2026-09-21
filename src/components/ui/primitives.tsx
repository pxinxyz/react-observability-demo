import * as Separator from '@radix-ui/react-separator'
import * as Tooltip from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Small presentational primitives.
 *
 * Kept in one file on purpose: these are a dozen one-line components, and
 * splitting them across twelve files would make the component directory harder
 * to read, not easier.
 */

export function Panel({
  children,
  className,
  as: Component = 'section',
}: {
  children: ReactNode
  className?: string
  as?: 'section' | 'div' | 'article' | 'aside'
}) {
  return (
    <Component
      className={cn(
        'rounded-lg border border-edge bg-panel/80 backdrop-blur-sm',
        'shadow-[0_1px_0_0_rgba(255,255,255,0.02)_inset]',
        className,
      )}
    >
      {children}
    </Component>
  )
}

export function PanelHeader({
  title,
  subtitle,
  icon: Icon,
  actions,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  icon?: LucideIcon
  actions?: ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-edge px-4 py-3',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {Icon ? <Icon className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden /> : null}
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>
          {subtitle ? (
            <p className="mt-0.5 text-sm leading-relaxed text-subtle">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export type Tone = 'neutral' | 'ok' | 'warn' | 'crit' | 'accent' | 'info'

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'border-edge-strong bg-raised text-muted',
  ok: 'border-ok/30 bg-ok/10 text-ok',
  warn: 'border-warn/30 bg-warn/10 text-warn',
  crit: 'border-crit/30 bg-crit/10 text-crit',
  accent: 'border-accent/30 bg-accent/10 text-accent',
  info: 'border-info/30 bg-info/10 text-info',
}

export function Badge({
  children,
  tone = 'neutral',
  className,
  mono = false,
}: {
  children: ReactNode
  tone?: Tone
  className?: string
  mono?: boolean
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium leading-4',
        TONE_CLASSES[tone],
        mono && 'font-mono',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function StatusDot({
  tone = 'neutral',
  pulse = false,
  className,
}: {
  tone?: Tone
  pulse?: boolean
  className?: string
}) {
  const colors: Record<Tone, string> = {
    neutral: 'bg-subtle',
    ok: 'bg-ok',
    warn: 'bg-warn',
    crit: 'bg-crit',
    accent: 'bg-accent',
    info: 'bg-info',
  }
  return (
    <span
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full',
        colors[tone],
        pulse && 'animate-pulse-dot',
        className,
      )}
      aria-hidden
    />
  )
}

export function Button({
  children,
  onClick,
  variant = 'ghost',
  size = 'md',
  disabled = false,
  className,
  title,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'ghost' | 'solid' | 'outline'
  size?: 'sm' | 'md'
  disabled?: boolean
  className?: string
  title?: string
  type?: 'button' | 'submit'
}) {
  const variants = {
    ghost: 'text-muted hover:bg-raised hover:text-ink',
    solid: 'bg-accent/15 text-accent hover:bg-accent/25 border-accent/30',
    outline: 'border border-edge-strong text-muted hover:border-edge-strong hover:text-ink',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded border border-transparent font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' ? 'px-2 py-1 text-xs' : 'px-2.5 py-1.5 text-sm',
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  )
}

export function InfoTip({ children, label }: { children: ReactNode; label: string }) {
  return (
    <Tooltip.Root delayDuration={150}>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          className="cursor-help text-subtle underline decoration-dotted underline-offset-2 hover:text-muted"
        >
          {label}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          className="z-50 max-w-xs rounded-md border border-edge-strong bg-raised px-2.5 py-2 text-sm leading-relaxed text-muted shadow-xl"
        >
          {children}
          <Tooltip.Arrow className="fill-[var(--color-edge-strong)]" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export function Divider({ className }: { className?: string }) {
  return <Separator.Root className={cn('h-px w-full bg-edge', className)} />
}

/** A labelled number, used across the header strip and metric tiles. */
export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
  className,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: Tone
  className?: string
}) {
  const valueTone: Record<Tone, string> = {
    neutral: 'text-ink',
    ok: 'text-ok',
    warn: 'text-warn',
    crit: 'text-crit',
    accent: 'text-accent',
    info: 'text-info',
  }
  return (
    <div className={cn('min-w-0', className)}>
      <div className="text-xs font-medium uppercase tracking-wider text-subtle">{label}</div>
      <div className={cn('tnum mt-1 text-xl font-semibold leading-none', valueTone[tone])}>
        {value}
      </div>
      {hint ? <div className="mt-1 text-sm text-subtle">{hint}</div> : null}
    </div>
  )
}

/** Horizontal 0..1 meter. `tone` controls the fill. */
export function Meter({
  value,
  tone = 'accent',
  className,
}: {
  value: number
  tone?: Tone
  className?: string
}) {
  const fills: Record<Tone, string> = {
    neutral: 'bg-subtle',
    ok: 'bg-ok',
    warn: 'bg-warn',
    crit: 'bg-crit',
    accent: 'bg-accent',
    info: 'bg-info',
  }
  const pct = Math.min(100, Math.max(0, value * 100))
  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-edge', className)}
      role="presentation"
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-500', fills[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

/**
 * Labels whether a panel's contents are real telemetry or simulated data.
 *
 * This exists because the distinction is the whole point of the project and it
 * should be impossible to miss while looking at the screen — not buried in the
 * README.
 */
export function ProvenanceTag({ kind }: { kind: 'real' | 'simulated' }) {
  const isReal = kind === 'real'
  return (
    <Tooltip.Root delayDuration={150}>
      <Tooltip.Trigger asChild>
        <span
          className={cn(
            'inline-flex cursor-help items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-2xs uppercase tracking-wide',
            isReal
              ? 'border-ok/30 bg-ok/10 text-ok'
              : 'border-info/30 bg-info/10 text-info',
          )}
        >
          <span
            className={cn('size-1 rounded-full', isReal ? 'bg-ok' : 'bg-info')}
            aria-hidden
          />
          {isReal ? 'real' : 'simulated'}
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          className="z-50 max-w-xs rounded-md border border-edge-strong bg-raised px-2.5 py-2 text-sm leading-relaxed text-muted shadow-xl"
        >
          {isReal ? (
            <>
              <strong className="text-ok">Genuine telemetry.</strong> Emitted by this browser
              through the OpenTelemetry SDK and exported over OTLP.
            </>
          ) : (
            <>
              <strong className="text-info">Fabricated data.</strong> Generated by the simulator
              in <code className="font-mono">simulator/</code>. No real system is being observed
              here.
            </>
          )}
          <Tooltip.Arrow className="fill-[var(--color-edge-strong)]" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon
  title: string
  description: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {Icon ? <Icon className="size-6 text-subtle" aria-hidden /> : null}
      <p className="text-base font-medium text-muted">{title}</p>
      <p className="max-w-md text-sm leading-relaxed text-subtle">{description}</p>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <p className="text-base font-medium text-crit">Request failed</p>
      <p className="max-w-md font-mono text-sm leading-relaxed text-subtle">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
          Retry
        </Button>
      ) : null}
    </div>
  )
}
