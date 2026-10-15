import { Link, NavLink } from 'react-router-dom';

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="VM One Product Advisor home">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary font-serif text-lg font-semibold text-white">
        V
      </span>
      <span className="leading-tight">
        <span className="block font-serif text-lg font-semibold text-ink">VM One</span>
        <span className="block text-[11px] font-medium text-ink-400">Product Advisor</span>
      </span>
    </Link>
  );
}

export default function Header() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-full px-4 py-2 text-sm font-semibold transition-colors ${isActive ? 'bg-cream-100 text-ink' : 'text-ink-500 hover:text-ink'}`;

  return (
    <header className="sticky top-0 z-40 border-b border-cream-200/80 bg-cream/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-1">
          <NavLink to="/" end className={linkClass}>Home</NavLink>
          <NavLink to="/ask" className={({ isActive }) => `${linkClass({ isActive })} hidden sm:inline-flex`}>Find a product</NavLink>
          <Link to="/ask" className="ml-1 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink-700 sm:hidden">
            Start
          </Link>
        </nav>
      </div>
    </header>
  );
}
