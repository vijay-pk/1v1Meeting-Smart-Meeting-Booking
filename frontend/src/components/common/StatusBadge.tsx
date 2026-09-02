import type { BookingStatus } from '@/types';
import { Badge } from '@/components/ui/badge';
import { BOOKING_STATUS_LABELS } from '@/lib/constants';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'outline' | 'info'> = {
  pending_payment: 'warning',
  payment_received: 'info',
  confirmed: 'success',
  cancelled: 'destructive',
  completed: 'secondary',
  expired: 'outline',
  refunded: 'default',
  calendar_failed: 'warning',
};

interface StatusBadgeProps {
  status: BookingStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <Badge variant={STATUS_VARIANT[status] || 'outline'} className={className}>
      {BOOKING_STATUS_LABELS[status] || status}
    </Badge>
  );
}
