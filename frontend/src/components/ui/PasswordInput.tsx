import * as React from 'react';
import { Input, type InputProps } from '@/components/ui/input';
import { PasswordToggle } from '@/components/auth/AuthField';
import { cn } from '@/lib/utils';

/**
 * A password field with its own show/hide eye toggle.
 *
 * Toggling flips only the `type` on the same input element, so the value, focus and cursor
 * position are preserved. The visibility state is local to each instance, so showing one
 * password never reveals another on the same form. Reuses PasswordToggle for the eye / eye-off
 * icons and the "Show password" / "Hide password" accessible labels.
 *
 * Drop-in replacement for `<Input type="password" ... />`. The caller keeps its own <Label>.
 */
export type PasswordInputProps = Omit<InputProps, 'type'>;

export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className, ...props }, ref) {
    const [visible, setVisible] = React.useState(false);
    return (
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? 'text' : 'password'}
          // Room for the toggle so it never overlaps the typed value.
          className={cn('pr-12', className)}
          {...props}
        />
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
          <PasswordToggle visible={visible} onToggle={() => setVisible((v) => !v)} />
        </div>
      </div>
    );
  }
);
