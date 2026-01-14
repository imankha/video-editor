import React from 'react';

/**
 * Button - Unified button component for consistent styling across the app
 *
 * STYLE GUIDE:
 * - Primary (purple): Main actions, confirmations, "do this" buttons
 * - Secondary (gray): Cancel, back, neutral actions
 * - Success (green): Positive actions like Add, Play, Load, Export success
 * - Danger (red): Delete, destructive actions
 * - Ghost: Minimal styling, for toolbars and compact UIs
 *
 * SIZES:
 * - sm: Compact buttons, toolbars, inline actions
 * - md: Default, most buttons
 * - lg: Primary CTAs, prominent actions
 *
 * @example
 * // Primary action
 * <Button variant="primary" onClick={handleSave}>Save Project</Button>
 *
 * // With icon
 * <Button variant="secondary" icon={ArrowLeft}>Back</Button>
 *
 * // Icon only
 * <Button variant="ghost" icon={Play} size="sm" iconOnly />
 *
 * // Full width
 * <Button variant="primary" size="lg" fullWidth>Export Video</Button>
 */
export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  iconOnly = false,
  fullWidth = false,
  disabled = false,
  loading = false,
  className = '',
  ...props
}) {
  // Base styles applied to all buttons
  const baseStyles = [
    'inline-flex items-center justify-center gap-2',
    'font-medium rounded-lg',
    'transition-colors duration-150',
    'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900',
    disabled || loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
  ].join(' ');

  // Variant styles
  const variantStyles = {
    primary: [
      'bg-purple-600 text-white',
      !disabled && !loading && 'hover:bg-purple-700',
      'focus:ring-purple-500',
    ].filter(Boolean).join(' '),

    secondary: [
      'bg-gray-700 text-white',
      !disabled && !loading && 'hover:bg-gray-600',
      'focus:ring-gray-500',
    ].filter(Boolean).join(' '),

    success: [
      'bg-green-600 text-white',
      !disabled && !loading && 'hover:bg-green-700',
      'focus:ring-green-500',
    ].filter(Boolean).join(' '),

    danger: [
      'bg-red-600 text-white',
      !disabled && !loading && 'hover:bg-red-700',
      'focus:ring-red-500',
    ].filter(Boolean).join(' '),

    ghost: [
      'bg-transparent text-gray-300',
      !disabled && !loading && 'hover:bg-gray-700 hover:text-white',
      'focus:ring-gray-500',
    ].filter(Boolean).join(' '),

    outline: [
      'bg-transparent text-gray-300 border border-gray-600',
      !disabled && !loading && 'hover:bg-gray-700 hover:text-white hover:border-gray-500',
      'focus:ring-gray-500',
    ].filter(Boolean).join(' '),
  };

  // Size styles
  const sizeStyles = {
    sm: iconOnly ? 'p-1.5' : 'px-3 py-1.5 text-sm',
    md: iconOnly ? 'p-2' : 'px-4 py-2 text-sm',
    lg: iconOnly ? 'p-3' : 'px-6 py-3 text-base',
  };

  // Icon sizes based on button size
  const iconSizes = {
    sm: 14,
    md: 16,
    lg: 18,
  };

  const iconSize = iconSizes[size];

  return (
    <button
      className={[
        baseStyles,
        variantStyles[variant],
        sizeStyles[size],
        fullWidth && 'w-full',
        className,
      ].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <LoadingSpinner size={iconSize} />
      ) : Icon ? (
        <Icon size={iconSize} />
      ) : null}

      {!iconOnly && children}

      {IconRight && !loading && (
        <IconRight size={iconSize} />
      )}
    </button>
  );
}

/**
 * IconButton - Compact icon-only button for toolbars
 *
 * @example
 * <IconButton icon={Play} onClick={togglePlay} variant="success" />
 * <IconButton icon={Trash2} onClick={handleDelete} variant="danger" />
 */
export function IconButton({
  icon: Icon,
  size = 'md',
  variant = 'ghost',
  round = false,
  ...props
}) {
  const sizeStyles = {
    sm: 'p-1',
    md: 'p-1.5',
    lg: 'p-2',
  };

  const iconSizes = {
    sm: 14,
    md: 16,
    lg: 18,
  };

  return (
    <Button
      variant={variant}
      className={[sizeStyles[size], round && 'rounded-full'].filter(Boolean).join(' ')}
      iconOnly
      {...props}
    >
      {Icon && <Icon size={iconSizes[size]} />}
    </Button>
  );
}

/**
 * ButtonGroup - Container for grouping related buttons
 *
 * @example
 * <ButtonGroup>
 *   <Button variant="secondary">Cancel</Button>
 *   <Button variant="primary">Save</Button>
 * </ButtonGroup>
 */
export function ButtonGroup({ children, className = '' }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {children}
    </div>
  );
}

/**
 * Loading spinner for button loading state
 */
function LoadingSpinner({ size = 16 }) {
  return (
    <svg
      className="animate-spin"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

export default Button;
