import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, BadgeCheck, CirclePlay, IndianRupee, MessageCircleQuestion } from 'lucide-react';
import { categoryMeta, FEATURED } from '../lib/categories';

type Category = { slug: string; name: string };

const STEPS = [
  { icon: MessageCircleQuestion, title: 'Tell us what you need', text: 'Pick a product and answer a few easy questions about your budget and home.' },
  { icon: BadgeCheck, title: 'We find your match', text: "We go through the products VM One has reviewed and pick the ones that fit you best." },
  { icon: CirclePlay, title: 'Watch, then buy', text: 'See the VM One review, check the price and buy with confidence.' },
];

export default function HomePage() {
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    fetch('/api/categories')
      .then(r => r.json())
      .then(d => d.ok && setCategories(d.categories))
      .catch(() => {});
  }, []);

  const featured = FEATURED.map(slug => categories.find(c => c.slug === slug)).filter(Boolean) as Category[];
  const rest = categories.filter(c => !FEATURED.includes(c.slug));

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-14 sm:px-6 md:grid-cols-[1.15fr_1fr] md:pt-20">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: 'easeOut' }}>
            <span className="inline-flex items-center gap-2 rounded-full border border-cream-300 bg-white px-3.5 py-1.5 text-sm font-medium text-ink-500">
              <span className="h-2 w-2 rounded-full bg-primary" />
              Picked from VM One reviews
            </span>
            <h1 className="mt-6 text-[2.6rem] font-medium leading-[1.08] text-ink sm:text-6xl">
              Buy the right appliance, <em className="font-serif italic text-primary">the first time.</em>
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-ink-500">
              Not sure which TV, AC or fridge to buy? Answer a few simple questions and we'll suggest what VM One would recommend for you.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link to="/ask" className="btn-primary text-base">
                Find my product <ArrowRight className="h-5 w-5" />
              </Link>
              <span className="text-sm text-ink-400 sm:ml-2">Takes about a minute · Free</span>
            </div>
          </motion.div>

          {/* Friendly preview card */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15, ease: 'easeOut' }}
            className="relative mx-auto w-full max-w-sm"
          >
            <div className="absolute -inset-4 -z-10 rounded-[2.5rem] bg-primary-50" />
            <div className="card p-6">
              <p className="eyebrow">Your match</p>
              <div className="mt-4 flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-cream-100">
                  {(() => { const Icon = categoryMeta('tv').icon; return <Icon className="h-8 w-8 text-ink-700" strokeWidth={1.5} />; })()}
                </div>
                <div>
                  <p className="font-serif text-xl text-ink">43" 4K Smart TV</p>
                  <p className="text-sm text-ink-400">Fits your budget</p>
                </div>
              </div>
              <ul className="mt-5 space-y-2.5 text-sm text-ink-700">
                {['Under ₹45,000', 'Great for movies', 'Reviewed by VM One'].map(t => (
                  <li key={t} className="flex items-center gap-2.5">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-leaf-50 text-leaf-600">✓</span>
                    {t}
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex items-center justify-between rounded-2xl bg-cream-100 px-4 py-3">
                <span className="flex items-center gap-2 text-sm font-medium text-ink-700">
                  <CirclePlay className="h-5 w-5 text-primary" /> Watch the review
                </span>
                <ArrowRight className="h-4 w-4 text-ink-400" />
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Categories */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mb-8 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="eyebrow">Start here</p>
            <h2 className="mt-2 text-3xl font-medium text-ink sm:text-4xl">What are you shopping for?</h2>
          </div>
          <Link to="/ask" className="text-sm font-semibold text-ink-500 hover:text-ink">See all categories →</Link>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {(featured.length ? featured : FEATURED.map(slug => ({ slug, name: '' }))).map(c => {
            const { icon: Icon, blurb } = categoryMeta(c.slug);
            return (
              <Link
                key={c.slug}
                to={`/ask?category=${c.slug}`}
                className="group card flex flex-col gap-4 p-5 transition-all hover:-translate-y-0.5 hover:shadow-lift"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cream-100 transition-colors group-hover:bg-primary-50">
                  <Icon className="h-6 w-6 text-ink-700 transition-colors group-hover:text-primary" strokeWidth={1.6} />
                </span>
                <span>
                  <span className="block font-semibold text-ink">{c.name || ' '}</span>
                  <span className="mt-0.5 block text-sm text-ink-400">{blurb}</span>
                </span>
              </Link>
            );
          })}
        </div>

        {rest.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2">
            {rest.map(c => (
              <Link
                key={c.slug}
                to={`/ask?category=${c.slug}`}
                className="rounded-full border border-cream-300 bg-white px-4 py-2 text-sm font-medium text-ink-700 transition-colors hover:border-primary-300 hover:text-primary"
              >
                {c.name}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* How it works */}
      <section className="mx-auto mt-24 max-w-6xl px-4 sm:px-6">
        <div className="text-center">
          <p className="eyebrow">How it works</p>
          <h2 className="mt-2 text-3xl font-medium text-ink sm:text-4xl">Three easy steps</h2>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <div key={title} className="relative rounded-3xl bg-cream-100/70 p-7">
              <span className="font-serif text-5xl text-cream-300">{i + 1}</span>
              <Icon className="absolute right-7 top-8 h-6 w-6 text-primary" strokeWidth={1.6} />
              <h3 className="mt-4 font-sans text-lg font-semibold text-ink">{title}</h3>
              <p className="mt-2 leading-relaxed text-ink-500">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust */}
      <section className="mx-auto mt-24 max-w-6xl px-4 sm:px-6">
        <div className="card grid gap-10 overflow-hidden p-8 sm:p-12 md:grid-cols-[1.3fr_1fr] md:items-center">
          <div>
            <h2 className="text-3xl font-medium leading-tight text-ink sm:text-4xl">
              Advice you can trust, not ads.
            </h2>
            <p className="mt-4 max-w-md leading-relaxed text-ink-500">
              We only suggest products VM One has covered in its videos and buying guides. You'll see why each one suits you, and you can watch the review before you buy.
            </p>
            <Link to="/ask" className="btn-primary mt-8">
              Get my recommendation <ArrowRight className="h-5 w-5" />
            </Link>
          </div>
          <ul className="space-y-4">
            {[
              { icon: BadgeCheck, text: 'Only products VM One has reviewed' },
              { icon: IndianRupee, text: 'Matched to the budget you choose' },
              { icon: CirclePlay, text: 'The VM One video, right next to your result' },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-4 rounded-2xl bg-cream-100/70 px-5 py-4">
                <Icon className="h-5 w-5 shrink-0 text-primary" strokeWidth={1.8} />
                <span className="font-medium text-ink-700">{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
