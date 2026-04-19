"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { submitClarifications } from "../actions";

export interface ClarifyingQuestion {
  id: string;
  question: string;
  options?: string[];
  why?: string;
}

interface Props {
  jobId: string;
  jobStatus: string;
  questions: ClarifyingQuestion[];
  reason?: string;
}

export function ClarifyingQuestionsCard({
  jobId,
  jobStatus,
  questions,
  reason,
}: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = jobStatus !== "completed";

  const canSubmit =
    !disabled &&
    questions.length > 0 &&
    questions.every((q) => {
      const a = answers[q.id];
      return typeof a === "string" && a.trim().length > 0;
    });

  const handleChange = (id: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitClarifications(jobId, answers);
      if (result?.error) {
        setError(result.error);
        setSubmitting(false);
      }
      // Success path redirects server-side.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
      setSubmitting(false);
    }
  };

  return (
    <div>
      {reason && (
        <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">
          {reason}
        </p>
      )}

      <div className="mb-6 space-y-5">
        {questions.map((q) => (
          <div key={q.id} className="space-y-2">
            <label
              htmlFor={`cq-${q.id}`}
              className="block text-sm font-medium text-zinc-900 dark:text-zinc-100"
            >
              {q.question}
            </label>
            {q.why && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {q.why}
              </p>
            )}
            {q.options && q.options.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {q.options.map((opt) => {
                  const selected = answers[q.id] === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => handleChange(q.id, opt)}
                      disabled={disabled}
                      className={`rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        selected
                          ? "border-[#fe591f] bg-[#fe591f]/10 text-[#fe591f]"
                          : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 hover:border-zinc-400 dark:hover:border-zinc-600"
                      }`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            ) : (
              <input
                id={`cq-${q.id}`}
                type="text"
                value={answers[q.id] ?? ""}
                onChange={(e) => handleChange(q.id, e.target.value)}
                disabled={disabled}
                placeholder="Your answer"
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:border-[#fe591f] focus:outline-none focus:ring-1 focus:ring-[#fe591f] disabled:cursor-not-allowed disabled:opacity-50"
              />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-4 py-2 text-sm text-red-600 dark:text-red-300">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit || submitting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#fe591f] px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#fe591f]/90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
        {submitting ? "Submitting..." : "Continue with answers"}
      </button>
    </div>
  );
}
