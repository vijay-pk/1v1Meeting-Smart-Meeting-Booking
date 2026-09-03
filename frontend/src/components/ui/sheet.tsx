import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Bottom sheet.
 *
 * Built on @radix-ui/react-dialog (already a dependency) so it inherits the focus trap, Esc
 * handling and scroll locking for free. It is a separate file from dialog.tsx on purpose:
 * the public booking flow renders a DialogContent, and a new component cannot regress it.
 *
 * Used for the mobile presentations where a centred modal is awkward to reach one-handed —
 * the navigation "More" menu, the notification list, and the SuperProfile import on a phone.
 */

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;
const SheetPortal = DialogPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-overlay=""
    className={cn('fixed inset-0 z-50 bg-overlay backdrop-blur-sm', className)}
    {...props}
  />
));
SheetOverlay.displayName = 'SheetOverlay';

const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { title?: string }
>(({ className, children, title, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      data-sheet=""
      className={cn(
        // Anchored to the bottom edge, capped at 90% of the *dynamic* viewport so the mobile
        // browser chrome cannot push the action buttons out of reach, and padded past the
        // home indicator via the safe-area inset.
        'admin-sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-2xl border-t border-border bg-surface-elevated shadow-dropdown focus:outline-none',
        className
      )}
      {...props}
    >
      {/* Grab handle: the affordance that says "this can be dismissed downward". */}
      <div className="flex shrink-0 justify-center pt-2.5 pb-1" aria-hidden="true">
        <div className="h-1 w-10 rounded-full bg-border-strong" />
      </div>

      {title && (
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-3 pt-1">
          <DialogPrimitive.Title className="text-base font-semibold text-text-primary">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close className="press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
            <X className="h-4.5 w-4.5" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </div>
      )}

      <div className="safe-b min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
        {children}
      </div>
    </DialogPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = 'SheetContent';

const SheetTitle = DialogPrimitive.Title;
const SheetDescription = DialogPrimitive.Description;

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetPortal,
  SheetOverlay,
  SheetContent,
  SheetTitle,
  SheetDescription,
};
