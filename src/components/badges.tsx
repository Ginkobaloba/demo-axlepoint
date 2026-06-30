import { cn } from "@/lib/cn";
import {
  PO_STATUS_LABELS,
  RISK_BAND_LABELS,
  WO_STATUS_LABELS,
  WO_TYPE_LABELS,
  type AnomalySeverity,
  type AssetStatus,
  type PurchaseOrderStatus,
  type RiskBand,
  type WorkOrderPriority,
  type WorkOrderStatus,
  type WorkOrderType,
} from "@/lib/types";

// Static class maps so Tailwind's JIT compiler sees every class literal.

const BAND_CHIP: Record<RiskBand, string> = {
  low: "bg-risk-low/10 text-risk-low",
  medium: "bg-risk-medium/15 text-risk-medium",
  high: "bg-risk-high/10 text-risk-high",
  critical: "bg-risk-critical/10 text-risk-critical",
};

const BAND_BAR: Record<RiskBand, string> = {
  low: "bg-risk-low",
  medium: "bg-risk-medium",
  high: "bg-risk-high",
  critical: "bg-risk-critical",
};

const BAND_TEXT: Record<RiskBand, string> = {
  low: "text-risk-low",
  medium: "text-risk-medium",
  high: "text-risk-high",
  critical: "text-risk-critical",
};

export function RiskChip({ band }: { band: RiskBand }) {
  return (
    <span className={cn("chip", BAND_CHIP[band])}>
      {RISK_BAND_LABELS[band]}
    </span>
  );
}

export function RiskBar({
  score,
  band,
  className,
}: {
  score: number;
  band: RiskBand;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-line">
        <span
          className={cn("block h-full rounded-full", BAND_BAR[band])}
          style={{ width: `${Math.max(3, score)}%` }}
        />
      </span>
      <span
        className={cn("w-7 text-right font-mono text-sm font-semibold", BAND_TEXT[band])}
      >
        {Math.round(score)}
      </span>
    </span>
  );
}

const SEVERITY_CHIP: Record<AnomalySeverity, string> = {
  minor: "bg-risk-medium/15 text-risk-medium",
  major: "bg-risk-high/10 text-risk-high",
  severe: "bg-risk-critical/10 text-risk-critical",
};

export function SeverityChip({ severity }: { severity: AnomalySeverity }) {
  return (
    <span className={cn("chip capitalize", SEVERITY_CHIP[severity])}>
      {severity}
    </span>
  );
}

const ASSET_STATUS_CHIP: Record<AssetStatus, string> = {
  operational: "bg-risk-low/10 text-risk-low",
  degraded: "bg-risk-high/10 text-risk-high",
  maintenance: "bg-gold/15 text-ink-soft",
  offline: "bg-ink/10 text-ink-soft",
};

export function AssetStatusChip({ status }: { status: AssetStatus }) {
  return (
    <span className={cn("chip capitalize", ASSET_STATUS_CHIP[status])}>
      {status}
    </span>
  );
}

const WO_STATUS_CHIP: Record<WorkOrderStatus, string> = {
  open: "bg-gold/15 text-ink-soft",
  in_progress: "bg-forest/10 text-forest",
  awaiting_parts: "bg-risk-high/10 text-risk-high",
  closed: "bg-ink/5 text-ink-faint",
};

export function WoStatusChip({ status }: { status: WorkOrderStatus }) {
  return (
    <span className={cn("chip", WO_STATUS_CHIP[status])}>
      {WO_STATUS_LABELS[status]}
    </span>
  );
}

const PRIORITY_CHIP: Record<WorkOrderPriority, string> = {
  low: "bg-ink/5 text-ink-faint",
  medium: "bg-gold/15 text-ink-soft",
  high: "bg-risk-high/10 text-risk-high",
  urgent: "bg-risk-critical/10 text-risk-critical",
};

export function PriorityChip({ priority }: { priority: WorkOrderPriority }) {
  return (
    <span className={cn("chip capitalize", PRIORITY_CHIP[priority])}>
      {priority}
    </span>
  );
}

export function WoTypeChip({ type }: { type: WorkOrderType }) {
  return (
    <span className="chip border border-line bg-panel text-ink-soft">
      {WO_TYPE_LABELS[type]}
    </span>
  );
}

const PO_STATUS_CHIP: Record<PurchaseOrderStatus, string> = {
  draft: "bg-gold/15 text-ink-soft",
  ordered: "bg-forest/10 text-forest",
  received: "bg-risk-low/10 text-risk-low",
  cancelled: "bg-ink/5 text-ink-faint",
};

export function PoStatusChip({ status }: { status: PurchaseOrderStatus }) {
  return (
    <span className={cn("chip", PO_STATUS_CHIP[status])}>
      {PO_STATUS_LABELS[status]}
    </span>
  );
}
