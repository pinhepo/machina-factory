"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CATEGORIES, useMentions } from "./mention-hooks";
import type { CategoryKey, MentionItem } from "./mention-hooks";

interface MentionPickerProps {
  query: string;
  onSelect: (item: MentionItem) => void;
  onClose: () => void;
  position: { top: number; left: number };
  selectedIds: Set<string>;
}

/**
 * Mention picker — rail-style palette.
 *
 * Layout:
 *   ┌───────────────────────────────────────────────┐
 *   │ Rail (categories)  │  Results list            │
 *   │                    │                          │
 *   ├────────────────────┴──────────────────────────┤
 *   │ keyboard hints                                │
 *   └───────────────────────────────────────────────┘
 *
 * Keeps the original hook contract (query / selectedIds / onSelect / onClose)
 * and keyboard semantics (↑↓ navigate, ↵ select, Tab next category, Esc close).
 */
export function MentionPicker({
  query,
  onSelect,
  onClose,
  position,
  selectedIds,
}: MentionPickerProps) {
  const [activeCategory, setActiveCategory] = useState<CategoryKey>("code");
  const { byCategory, loading } = useMentions(query);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeCat = CATEGORIES.find((c) => c.key === activeCategory);
  const activeItems = byCategory[activeCategory].flat;

  useEffect(() => {
    setSelectedIndex(0);
  }, [activeCategory, query]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (activeItems.length > 0) {
          setSelectedIndex((i) => (i + 1) % activeItems.length);
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (activeItems.length > 0) {
          setSelectedIndex(
            (i) => (i - 1 + activeItems.length) % activeItems.length,
          );
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = activeItems[selectedIndex];
        if (item) onSelect(item);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab") {
        e.preventDefault();
        const idx = CATEGORIES.findIndex((c) => c.key === activeCategory);
        const dir = e.shiftKey ? -1 : 1;
        const next =
          CATEGORIES[(idx + dir + CATEGORIES.length) % CATEGORIES.length];
        setActiveCategory(next.key);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeItems, selectedIndex, onSelect, onClose, activeCategory]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const bucketed = activeCat?.hasBuckets
    ? {
        oss: byCategory[activeCategory].oss,
        machina: byCategory[activeCategory].machina,
      }
    : null;

  return (
    <div
      ref={containerRef}
      className="absolute z-50 w-[520px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.18)] dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.6)] overflow-hidden flex flex-col"
      style={{ top: position.top, left: position.left }}
    >
      <div className="flex min-h-[280px]">
        {/* Category rail */}
        <div className="w-[148px] shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40 p-1.5 flex flex-col gap-0.5">
          <div className="px-2 pt-1 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-zinc-400 dark:text-zinc-500">
            Mention
          </div>
          {CATEGORIES.map((cat) => {
            const count = byCategory[cat.key].flat.length;
            const active = activeCategory === cat.key;
            return (
              <RailTab
                key={cat.key}
                active={active}
                onClick={() => setActiveCategory(cat.key)}
                icon={cat.icon}
                label={cat.label}
                count={count}
              />
            );
          })}
          {query.length > 0 && (
            <div className="mt-auto px-2 pt-2 pb-1 text-[10px] text-zinc-400 dark:text-zinc-500 font-mono border-t border-zinc-200 dark:border-zinc-800">
              <span className="text-zinc-400">@</span>
              {query}
            </div>
          )}
        </div>

        {/* Results panel */}
        <div
          className="flex-1 min-w-0 max-h-[320px] overflow-y-auto"
          role="listbox"
          aria-label={`${activeCat?.label ?? "results"} mentions`}
        >
          {loading && activeItems.length === 0 ? (
            <LoadingState label={activeCat?.label.toLowerCase() ?? "results"} />
          ) : activeItems.length === 0 ? (
            <EmptyState />
          ) : bucketed ? (
            <BucketView
              oss={bucketed.oss}
              machina={bucketed.machina}
              selectedIndex={selectedIndex}
              selectedIds={selectedIds}
              onSelect={onSelect}
              onHover={setSelectedIndex}
              offset={0}
            />
          ) : (
            <FlatList
              items={activeItems}
              selectedIndex={selectedIndex}
              selectedIds={selectedIds}
              onSelect={onSelect}
              onHover={setSelectedIndex}
              offset={0}
            />
          )}
        </div>
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/60 px-3 py-1.5 text-[10px] text-zinc-500 flex items-center gap-3">
        <Hint label="navigate" keys={["↑", "↓"]} />
        <Hint label="select" keys={["↵"]} />
        <Hint label="next" keys={["⇥"]} />
        <Hint label="close" keys={["esc"]} />
        <span className="ml-auto text-zinc-400 dark:text-zinc-500">
          {activeItems.length} {activeItems.length === 1 ? "result" : "results"}
        </span>
      </div>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-10 text-xs text-zinc-500">
      <span className="inline-block h-3 w-3 rounded-full border-2 border-zinc-300/60 dark:border-zinc-700 border-t-[#fe591f] animate-spin" />
      Loading {label}…
    </div>
  );
}

function EmptyState() {
  return (
    <div className="p-10 text-center text-xs text-zinc-500">
      <div className="text-zinc-600 dark:text-zinc-400">Nothing here yet.</div>
      <div className="mt-1 text-[10px] text-zinc-400">
        Try another category or clear your search.
      </div>
    </div>
  );
}

function Hint({ label, keys }: { label: string; keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((k) => (
        <kbd
          key={k}
          className="inline-flex items-center justify-center min-w-[16px] h-[16px] rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-1 text-[9px] font-medium text-zinc-600 dark:text-zinc-400"
        >
          {k}
        </kbd>
      ))}
      <span>{label}</span>
    </span>
  );
}

function RailTab({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`group flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] font-medium transition-all ${
        active
          ? "bg-white dark:bg-zinc-800 text-[#fe591f] ring-1 ring-[#fe591f]/25 shadow-sm"
          : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100/80 dark:hover:bg-zinc-800/60"
      }`}
    >
      <span
        className={
          active ? "text-[#fe591f]" : "text-zinc-400 dark:text-zinc-500"
        }
      >
        {icon}
      </span>
      <span className="flex-1 text-left truncate">{label}</span>
      <span
        className={`text-[10px] font-normal tabular-nums ${
          active ? "text-[#fe591f]/80" : "text-zinc-400 dark:text-zinc-500"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function BucketView({
  oss,
  machina,
  selectedIndex,
  selectedIds,
  onSelect,
  onHover,
  offset,
}: {
  oss: MentionItem[];
  machina: MentionItem[];
  selectedIndex: number;
  selectedIds: Set<string>;
  onSelect: (item: MentionItem) => void;
  onHover: (idx: number) => void;
  offset: number;
}) {
  return (
    <div className="py-1">
      {oss.length > 0 && (
        <>
          <BucketHeader label="Open Source" sublabel="sports-skills" />
          <FlatList
            items={oss}
            selectedIndex={selectedIndex}
            selectedIds={selectedIds}
            onSelect={onSelect}
            onHover={onHover}
            offset={offset}
          />
        </>
      )}
      {machina.length > 0 && (
        <>
          <BucketHeader label="Machina" sublabel="connectors & templates" />
          <FlatList
            items={machina}
            selectedIndex={selectedIndex}
            selectedIds={selectedIds}
            onSelect={onSelect}
            onHover={onHover}
            offset={offset + oss.length}
          />
        </>
      )}
    </div>
  );
}

function BucketHeader({
  label,
  sublabel,
}: {
  label: string;
  sublabel: string;
}) {
  return (
    <div className="px-3 pt-2 pb-1 flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.08em] font-semibold text-zinc-500 dark:text-zinc-400">
        {label}
      </span>
      <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
        · {sublabel}
      </span>
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = {
  repo: "repo",
  job: "job",
  template: "template",
  workflow: "workflow",
  agent: "agent",
  cmd: "cmd",
  skill: "skill",
  connector: "connector",
};

const TYPE_DOT: Record<string, string> = {
  repo: "bg-zinc-400",
  job: "bg-blue-500",
  template: "bg-amber-500",
  workflow: "bg-violet-500",
  agent: "bg-emerald-500",
  cmd: "bg-slate-500",
  skill: "bg-rose-500",
  connector: "bg-cyan-500",
};

function FlatList({
  items,
  selectedIndex,
  selectedIds,
  onSelect,
  onHover,
  offset,
}: {
  items: MentionItem[];
  selectedIndex: number;
  selectedIds: Set<string>;
  onSelect: (item: MentionItem) => void;
  onHover: (idx: number) => void;
  offset: number;
}) {
  return (
    <div className="px-1 py-0.5">
      {items.map((item, idx) => {
        const globalIdx = offset + idx;
        const isSelected = globalIdx === selectedIndex;
        const isChosen = selectedIds.has(item.id);
        const typeLabel = TYPE_LABEL[item.type] ?? item.type;
        const dotClass = TYPE_DOT[item.type] ?? TYPE_DOT.repo;
        return (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={isSelected}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(item)}
            onMouseEnter={() => onHover(globalIdx)}
            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-left transition-colors ${
              isSelected
                ? "bg-[#fe591f]/10 ring-1 ring-[#fe591f]/25"
                : "hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
            } ${isChosen ? "opacity-55" : ""}`}
          >
            <span
              className={`shrink-0 h-1.5 w-1.5 rounded-full ${dotClass}`}
              aria-hidden
            />
            <span
              className={`shrink-0 ${
                isSelected ? "text-[#fe591f]" : "text-zinc-400 dark:text-zinc-500"
              }`}
            >
              {item.icon}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`text-[13px] truncate ${
                    isSelected
                      ? "text-zinc-900 dark:text-white font-medium"
                      : "text-zinc-800 dark:text-zinc-200"
                  }`}
                >
                  {item.title}
                </span>
                <span className="shrink-0 text-[9px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500 font-mono">
                  {typeLabel}
                </span>
              </div>
              {item.subtitle && (
                <div className="text-[11px] text-zinc-500 truncate">
                  {item.subtitle}
                </div>
              )}
            </div>
            {isChosen ? (
              <span className="shrink-0 text-[10px] text-zinc-400 italic">
                added
              </span>
            ) : isSelected ? (
              <kbd className="shrink-0 inline-flex items-center justify-center h-[16px] rounded border border-[#fe591f]/30 bg-[#fe591f]/10 px-1.5 text-[9px] font-medium text-[#fe591f]">
                ↵
              </kbd>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

