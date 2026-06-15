import React from 'react';

/**
 * CardIconButton - the 44x44 icon action button shared by reel and collection
 * cards (T3610). Same hit target + hover treatment everywhere.
 */
export function CardIconButton({
  icon: Icon,
  onClick,
  title,
  disabled,
  spinning,
  iconClassName = 'text-gray-400 hover:text-cyan-400',
  hoverClassName = 'hover:bg-gray-600',
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg transition-colors ${hoverClassName} ${
        disabled ? 'opacity-40 cursor-not-allowed' : ''
      }`}
    >
      <Icon size={20} className={`${spinning ? 'animate-spin ' : ''}${iconClassName}`} />
    </button>
  );
}

/**
 * CardMedia - the left 40x40 icon box shared by the cards. `children` is an
 * optional badge (e.g. the unwatched dot on reel cards).
 */
export function CardMedia({ icon: Icon, iconClassName, wrapClassName = '', children }) {
  return (
    <div className={`relative w-10 h-10 rounded flex items-center justify-center flex-shrink-0 ${wrapClassName}`}>
      <Icon size={20} className={iconClassName} />
      {children}
    </div>
  );
}

/**
 * CardStack - wraps a card with two diagonally-offset "sheets" behind it so it
 * reads as a STACK of clips (a collection), not a single clip. Purely a visual
 * indicator; the sheets are inert (pointer-events-none).
 *
 * @param {React.ReactNode} children      - the card to stack
 * @param {string=} layerClassName        - border/bg of the sheets (match the card tone)
 * @param {string=} className             - extra classes on the wrapper (e.g. margin)
 */
export function CardStack({ children, layerClassName = 'border-gray-600 bg-gray-700', className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <span aria-hidden="true" className={`pointer-events-none absolute inset-0 rounded-lg border ${layerClassName} translate-x-[6px] translate-y-[6px]`} />
      <span aria-hidden="true" className={`pointer-events-none absolute inset-0 rounded-lg border ${layerClassName} translate-x-[3px] translate-y-[3px]`} />
      <div className="relative">{children}</div>
    </div>
  );
}

/**
 * MediaCard - the shared card shell for reel + collection cards (T3610). Compact
 * single row: media (icon box) | content | inline actions, with an optional
 * footer (e.g. the Max Duration slider). Keeps the two card paths visually
 * identical by construction. `stacked` adds the stacked-paper collection cue.
 *
 * @param {React.ReactNode} media    - left icon box (use CardMedia)
 * @param {React.ReactNode} children - the text content (title row + meta)
 * @param {React.ReactNode=} actions - inline action buttons (use CardIconButton)
 * @param {React.ReactNode=} footer  - full-width content below the row
 * @param {string=} className        - overrides the default border (e.g. unwatched/locked)
 * @param {boolean=} stacked         - render the stacked-paper "collection" cue
 */
export function MediaCard({ media, children, actions, footer, className = '', stacked = false }) {
  const card = (
    <div className={`p-3 bg-gray-700 rounded-lg border transition-colors ${className || 'border-gray-600 hover:border-gray-500'}`}>
      <div className="flex items-center gap-3">
        {media}
        <div className="flex-1 min-w-0">{children}</div>
        {actions && <div className="flex items-center gap-1 flex-shrink-0">{actions}</div>}
      </div>
      {footer}
    </div>
  );
  return stacked ? <CardStack>{card}</CardStack> : card;
}

export default MediaCard;
