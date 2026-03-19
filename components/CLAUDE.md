# Components — Rules & Conventions

## Styling

- Semantic CSS classes defined in `app/globals.css` with CSS custom properties. Use these for all colors, component structure, and states.
- Tailwind is layout-only: grid, flex, padding, margin, gap. Never use Tailwind for colors or component-level styling.
- When adding a new component pattern, define its CSS class in `globals.css` first.

## Icons

- Library: Phosphor Icons (`@phosphor-icons/react`)
- Default: `size={24} weight="bold"`
- Active / toggled states: `weight="duotone"`
- Every icon button must have a `title` or `aria-label` tooltip.
