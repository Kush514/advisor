import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CircleAlert, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ProductCard from '../components/products/ProductCard';
import FinderResultCard from '../components/products/FinderResultCard';
import { FinderState, FinderProduct } from '@vmone/shared';
import { categoryMeta } from '../lib/categories';
import { labelKey } from '../lib/reasons';

const EMPTY_STATE: FinderState = {
  status: 'IDLE',
  categorySlug: null,
  categoryName: null,
  questions: [],
  currentQuestionIndex: 0,
  answers: {},
  results: [],
  error: null
};

export default function AskPage() {
  const [searchParams] = useSearchParams();
  const initialCategory = searchParams.get('category');

  const [state, setState] = useState<FinderState>({
    ...EMPTY_STATE,
    status: initialCategory ? 'QUESTIONS_LOADING' : 'IDLE',
    categorySlug: initialCategory
  });

  const [categories, setCategories] = useState<{ id: string; name: string; slug: string }[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const advanceTimer = useRef<number | null>(null);
  const refreshCounter = useRef(0);

  // Load categories if IDLE
  useEffect(() => {
    if (state.status === 'IDLE' && categories.length === 0) {
      fetch('/api/categories')
        .then(r => r.json())
        .then(data => {
          if (data.ok) setCategories(data.categories);
        })
        .catch(console.error);
    }
  }, [state.status, categories.length]);

  // Load questions when category selected
  useEffect(() => {
    if (state.status === 'QUESTIONS_LOADING' && state.categorySlug) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const ac = new AbortController();
      abortControllerRef.current = ac;

      fetch(`/api/categories/${state.categorySlug}/questions`, { signal: ac.signal })
        .then(r => r.json())
        .then(data => {
          if (!data.ok) throw new Error(data.error || 'Failed to load questions');
          setState(prev => ({
            ...prev,
            status: 'QUESTIONNAIRE_READY',
            categoryName: data.category.name,
            questions: data.questions,
            error: null
          }));
        })
        .catch(err => {
          if (err.name !== 'AbortError') {
            setState(prev => ({ ...prev, status: 'QUESTIONS_ERROR', error: err.message }));
          }
        });
    }
  }, [state.status, state.categorySlug]);

  useEffect(() => () => { if (advanceTimer.current) window.clearTimeout(advanceTimer.current); }, []);

  // Scroll to top whenever the screen changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [state.status, state.currentQuestionIndex]);

  const selectCategory = (slug: string, name: string) => {
    setState({ ...EMPTY_STATE, status: 'QUESTIONS_LOADING', categorySlug: slug, categoryName: name });
  };

  const isLastQuestion = state.currentQuestionIndex === state.questions.length - 1;

  const handleAnswer = (val: string) => {
    const index = state.currentQuestionIndex;
    const q = state.questions[index];
    const slug = state.categorySlug;

    // Later questions depend on this answer, so changing it clears the answers after it
    const answers: FinderState['answers'] = {};
    state.questions.slice(0, index).forEach(prevQ => {
      if (state.answers[prevQ.questionKey] !== undefined) answers[prevQ.questionKey] = state.answers[prevQ.questionKey];
    });
    answers[q.questionKey] = val;
    setState(prev => ({ ...prev, answers }));

    // Ask the API which options still exist for the remaining questions, then move on.
    // On the last question the user confirms with the button instead.
    if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
    const requestId = ++refreshCounter.current;
    const started = Date.now();
    fetch(`/api/categories/${slug}/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers })
    })
      .then(r => r.json())
      .then(data => {
        if (!data.ok || requestId !== refreshCounter.current) return;
        const apply = () =>
          setState(prev => {
            if (requestId !== refreshCounter.current || prev.categorySlug !== slug) return prev;
            const at = data.questions.findIndex((x: { questionKey: string }) => x.questionKey === q.questionKey);
            const isLast = at === data.questions.length - 1;
            return {
              ...prev,
              questions: data.questions,
              currentQuestionIndex: at < 0 ? prev.currentQuestionIndex : isLast ? at : at + 1
            };
          });
        // Keep the selection visible for a moment before sliding to the next question
        advanceTimer.current = window.setTimeout(apply, Math.max(0, 320 - (Date.now() - started)));
      })
      .catch(console.error);
  };

  const nextQuestion = () => {
    if (!isLastQuestion) {
      setState(prev => ({ ...prev, currentQuestionIndex: prev.currentQuestionIndex + 1 }));
    } else {
      submitAnswers();
    }
  };

  const prevQuestion = () => {
    refreshCounter.current++; // cancel any pending auto-advance
    if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
    if (state.currentQuestionIndex > 0) {
      setState(prev => ({ ...prev, currentQuestionIndex: prev.currentQuestionIndex - 1 }));
    }
  };

  const submitAnswers = () => {
    setState(prev => ({ ...prev, status: 'SUBMITTING', error: null }));

    fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: state.categorySlug,
        answers: state.answers
      })
    })
      .then(r => r.json())
      .then(data => {
        if (!data.ok) throw new Error(data.error || 'Failed to get recommendations');
        setState(prev => ({
          ...prev,
          status: 'RESULTS',
          results: data.products
        }));
      })
      .catch(err => {
        setState(prev => ({ ...prev, status: 'SUBMISSION_ERROR', error: err.message }));
      });
  };

  const editAnswers = () => {
    setState(prev => ({ ...prev, status: 'QUESTIONNAIRE_READY', currentQuestionIndex: 0, results: [] }));
  };

  const reset = () => {
    refreshCounter.current++;
    if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
    setState(EMPTY_STATE);
  };

  // Labels of what the user picked, for the results summary ("not sure" answers are left out)
  const choiceLabels = state.questions
    .map(q => q.options?.find(o => o.value !== 'any' && o.value === state.answers[q.questionKey])?.label)
    .filter(Boolean) as string[];

  // Option value -> label the user saw, so results read "7 kg" rather than "7"
  const answerLabels = new Map(
    state.questions.flatMap(q => (q.options || []).map(o => [labelKey(String(o.value)), o.label] as [string, string]))
  );

  const inQuestionnaire = ['QUESTIONNAIRE_READY', 'ANSWERING', 'SUBMISSION_ERROR'].includes(state.status) && state.questions.length > 0;
  const currentQuestion = state.questions[state.currentQuestionIndex];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      {/* ── Choose a category ── */}
      {state.status === 'IDLE' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <div className="mx-auto max-w-2xl text-center">
            <p className="eyebrow">Step 1</p>
            <h1 className="mt-3 text-4xl font-medium text-ink sm:text-5xl">What would you like to buy?</h1>
            <p className="mt-4 text-lg text-ink-500">Pick a product and answer a few quick questions. We'll suggest the one that suits you best.</p>
          </div>

          <motion.div
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.03 } } }}
            className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4"
          >
            {(categories.length ? categories : Array.from({ length: 8 }, (_, i) => ({ id: String(i), name: '', slug: '' }))).map(c => {
              const { icon: Icon, blurb } = categoryMeta(c.slug);
              return (
                <motion.button
                  key={c.id}
                  variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
                  onClick={() => c.slug && selectCategory(c.slug, c.name)}
                  disabled={!c.slug}
                  className="group card flex items-center gap-4 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-lift sm:p-5"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-cream-100 transition-colors group-hover:bg-primary-50">
                    {c.slug ? <Icon className="h-6 w-6 text-ink-700 transition-colors group-hover:text-primary" strokeWidth={1.6} /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold leading-snug text-ink">{c.name || <span className="inline-block h-4 w-24 animate-pulse rounded bg-cream-200" />}</span>
                    {c.slug && <span className="mt-0.5 hidden text-sm text-ink-400 sm:block">{blurb}</span>}
                  </span>
                </motion.button>
              );
            })}
          </motion.div>
        </motion.div>
      )}

      {/* ── Loading questions ── */}
      {state.status === 'QUESTIONS_LOADING' && (
        <div className="mx-auto max-w-2xl py-10">
          <div className="h-3 w-32 animate-pulse rounded-full bg-cream-200" />
          <div className="mt-6 h-10 w-3/4 animate-pulse rounded-xl bg-cream-200" />
          <div className="mt-10 space-y-3">
            {[0, 1, 2].map(i => <div key={i} className="h-16 animate-pulse rounded-2xl bg-white" />)}
          </div>
        </div>
      )}

      {/* ── Couldn't load ── */}
      {state.status === 'QUESTIONS_ERROR' && (
        <div className="card mx-auto mt-10 max-w-md p-10 text-center">
          <CircleAlert className="mx-auto h-10 w-10 text-primary" strokeWidth={1.6} />
          <h2 className="mt-5 text-2xl font-medium text-ink">We couldn't load the questions</h2>
          <p className="mt-2 text-ink-500">Please try again, or pick another product.</p>
          <button onClick={reset} className="btn-primary mt-8">Choose another product</button>
        </div>
      )}

      {/* ── Questions ── */}
      {(inQuestionnaire || state.status === 'SUBMITTING') && currentQuestion && (
        <div className="mx-auto max-w-2xl">
          <div className="flex items-center justify-between">
            <button onClick={reset} className="flex items-center gap-2 text-sm font-semibold text-ink-500 transition-colors hover:text-ink">
              <ArrowLeft className="h-4 w-4" /> Change product
            </button>
            {state.categoryName && (
              <span className="flex items-center gap-2 rounded-full border border-cream-300 bg-white px-3.5 py-1.5 text-sm font-medium text-ink-700">
                {(() => { const Icon = categoryMeta(state.categorySlug).icon; return <Icon className="h-4 w-4 text-primary" />; })()}
                {state.categoryName}
              </span>
            )}
          </div>

          {/* Progress */}
          <div className="mt-10">
            <p className="text-sm font-medium text-ink-400">
              Question {state.currentQuestionIndex + 1} of {state.questions.length}
            </p>
            <div className="mt-3 flex gap-1.5">
              {state.questions.map((q, i) => (
                <span
                  key={q.questionKey}
                  className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${i <= state.currentQuestionIndex ? 'bg-primary' : 'bg-cream-200'}`}
                />
              ))}
            </div>
          </div>

          {state.status === 'SUBMITTING' ? (
            <div className="py-24 text-center">
              <div className="mx-auto h-12 w-12 animate-spin rounded-full border-[3px] border-cream-200 border-t-primary" />
              <h2 className="mt-8 text-3xl font-medium text-ink">Finding your best match…</h2>
              <p className="mt-3 text-ink-500">Going through the {state.categoryName?.toLowerCase() || 'products'} VM One has reviewed.</p>
            </div>
          ) : (
            <>
              <AnimatePresence mode="wait">
                <motion.div
                  key={state.currentQuestionIndex}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                >
                  <h2 className="mt-8 text-3xl font-medium leading-tight text-ink sm:text-[2.5rem]">
                    {currentQuestion.questionText}
                  </h2>

                  <div className="mt-8 space-y-3" role="radiogroup" aria-label={currentQuestion.questionText}>
                    {currentQuestion.options?.map(opt => {
                      const isSelected = state.answers[currentQuestion.questionKey] === opt.value;
                      return (
                        <button
                          key={opt.value}
                          role="radio"
                          aria-checked={isSelected}
                          onClick={() => handleAnswer(opt.value)}
                          className={`flex w-full items-center justify-between gap-4 rounded-2xl border-2 px-5 py-4 text-left transition-all sm:px-6 sm:py-5 ${
                            isSelected
                              ? 'border-primary bg-primary-50/60'
                              : 'border-transparent bg-white shadow-soft hover:border-cream-300'
                          }`}
                        >
                          <span className={`text-lg font-medium ${isSelected ? 'text-ink' : 'text-ink-700'}`}>{opt.label}</span>
                          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${isSelected ? 'border-primary bg-primary' : 'border-cream-300'}`}>
                            {isSelected && <span className="h-2 w-2 rounded-full bg-white" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              </AnimatePresence>

              {state.status === 'SUBMISSION_ERROR' && (
                <div className="mt-6 flex items-start gap-3 rounded-2xl bg-primary-50 p-5 text-primary-800">
                  <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
                  <p>Something went wrong while finding your match. Please try again.</p>
                </div>
              )}

              <div className="mt-10 flex items-center justify-between">
                <button
                  onClick={prevQuestion}
                  disabled={state.currentQuestionIndex === 0}
                  className="flex items-center gap-2 rounded-full px-4 py-3 font-semibold text-ink-500 transition-colors hover:text-ink disabled:invisible"
                >
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <button
                  onClick={nextQuestion}
                  disabled={!state.answers[currentQuestion.questionKey]}
                  className="btn-primary"
                >
                  {isLastQuestion ? 'Show my match' : 'Next'} <ArrowRight className="h-5 w-5" />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Results ── */}
      {state.status === 'RESULTS' && (
        <div>
          <div className="mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <p className="eyebrow">Your recommendation</p>
              <h1 className="mt-3 text-4xl font-medium text-ink sm:text-5xl">
                {state.results.length ? "Here's what we'd buy" : 'No exact match yet'}
              </h1>
              {choiceLabels.length > 0 && (
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <span className="text-sm text-ink-400">Based on:</span>
                  {choiceLabels.map(l => (
                    <span key={l} className="rounded-full border border-cream-300 bg-white px-3 py-1 text-sm font-medium text-ink-700">{l}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={editAnswers} className="btn-secondary">Change answers</button>
              <button onClick={reset} className="btn-secondary"><RotateCcw className="h-4 w-4" /> Start over</button>
            </div>
          </div>

          {state.results.length === 0 ? (
            <div className="card mx-auto max-w-xl p-10 text-center sm:p-14">
              <h2 className="text-2xl font-medium text-ink">We couldn't find a perfect fit</h2>
              <p className="mt-3 leading-relaxed text-ink-500">
                None of the products VM One has reviewed match all your choices right now. Try a different budget or fewer preferences.
              </p>
              <button onClick={editAnswers} className="btn-primary mt-8">Change my answers</button>
            </div>
          ) : (
            <>
              <FinderResultCard product={state.results[0]} isTopMatch labels={answerLabels} />

              {state.results.length > 1 && (
                <section className="mt-16">
                  <h2 className="text-2xl font-medium text-ink sm:text-3xl">Other good options</h2>
                  <p className="mt-2 text-ink-500">Also reviewed by VM One and a good fit for what you need.</p>
                  <motion.div
                    initial="hidden"
                    animate="show"
                    variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.2 } } }}
                    className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
                  >
                    {state.results.slice(1).map((product: FinderProduct) => (
                      <ProductCard key={product.id} product={product} labels={answerLabels} />
                    ))}
                  </motion.div>
                </section>
              )}

              <p className="mt-12 text-center text-xs text-ink-400">
                Prices are from Amazon and can change. Some links are affiliate links that support VM One at no extra cost to you.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
