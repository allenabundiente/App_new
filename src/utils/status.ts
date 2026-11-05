/** Plain-language labels for the statuses stored in the database. */

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  overdue: 'Overdue',
  defaulted: 'In default',
  completed: 'Paid off',
  cancelled: 'Cancelled',
  pending: 'Pending',
  paid: 'Paid',
  skipped: 'Skipped',
  approved: 'Approved',
  rejected: 'Rejected',
  suspended: 'Suspended',
};

/** "overdue" -> "Overdue". Unknown values are passed through unchanged. */
export function statusLabel(status: string | null | undefined): string {
  if (!status) {
    return '';
  }
  return STATUS_LABELS[status] ?? status.charAt(0).toUpperCase() + status.slice(1);
}

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  down: 'Down payment',
  installment: 'Installment',
  settlement: 'Early settlement',
};

export function paymentTypeLabel(type: string): string {
  return PAYMENT_TYPE_LABELS[type] ?? statusLabel(type);
}
