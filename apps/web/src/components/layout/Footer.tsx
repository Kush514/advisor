import { Logo } from './Header';

export default function Footer() {
  return (
    <footer className="mt-24 border-t border-cream-200 bg-cream-100/60">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.2fr_2fr]">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-xs text-sm leading-relaxed text-ink-500">
            Honest appliance advice from the VM One YouTube channel, in a few simple questions.
          </p>
        </div>
        <div className="grid gap-6 text-sm leading-relaxed text-ink-500 sm:grid-cols-2">
          <div>
            <h4 className="mb-2 font-sans font-semibold text-ink">Only products we've covered</h4>
            <p>Every suggestion comes from a VM One video or buying guide, so you're choosing from products we've already looked at.</p>
          </div>
          <div>
            <h4 className="mb-2 font-sans font-semibold text-ink">How we earn</h4>
            <p>Some links are affiliate links. If you buy through them, VM One may earn a small commission at no extra cost to you.</p>
          </div>
        </div>
      </div>
      <div className="border-t border-cream-200 py-5 text-center text-xs text-ink-400">
        © {new Date().getFullYear()} VM One. Prices and availability can change on the seller's site.
      </div>
    </footer>
  );
}
