import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useEffect, useRef } from 'react';

type ButtonVariant = 'default' | 'primary' | 'danger';

export function Button({
  variant = 'default',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const variantClass = variant === 'default' ? '' : ` ui-btn--${variant}`;
  return <button className={`ui-btn${variantClass}${className ? ` ${className}` : ''}`} {...props} />;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="ui-input" {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="ui-textarea" {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="ui-select" {...props} />;
}

/** Native <dialog>-backed modal: focus-trapped and dismissible by Escape for free. */
export function Dialog({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="ui-dialog" onClose={onClose}>
      {open ? children : null}
    </dialog>
  );
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span style={{ position: 'relative' }} className="ui-tooltip-anchor" title={label}>
      {children}
    </span>
  );
}
