import { useState, type ChangeEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export function PasswordField({
  value,
  onChange,
  placeholder,
  autoComplete,
  required = true,
  className = '',
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  className?: string;
  id?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={`password-field ${className}`.trim()}>
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
      />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        title={visible ? 'Hide password' : 'Show password'}
        tabIndex={-1}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
