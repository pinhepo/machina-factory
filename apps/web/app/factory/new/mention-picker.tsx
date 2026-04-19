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

  const activeIdx = CATEGORIES.findIndex((c) => c.key === activeCategory);

  return (
    <div
      ref={containerRef}
      className="absolute z-50 w-[460px] rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 shadow-2xl overflow-hidden flex flex-col"
      style={{ top: position.top, left: position.left }}
    >
      <div className="flex items-center gap-1 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-950 px-2 py-1.5">
        <button
          type="button"
          aria-label="Previous category"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const prev =
              CATEGORIES[
                (activeIdx - 1 + CATEGORIES.length) % CATEGORIES.length
              ];
            setActiveCategory(prev.key);
          }}
          className="shrink-0 rounded-md px-1 py-1 text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          ‹
        </button>
        <div className="flex-1 flex items-center gap-0.5 overflow-x-auto scrollbar-none [&::-webkit-scrollbar]:hidden">
          {CATEGORIES.map((cat) => (
            <CategoryTab
              key={cat.key}
              active={activeCategory === cat.key}
              onClick={() => setActiveCategory(cat.key)}
              icon={cat.icon}
              label={cat.label}
            />
          ))}
        </div>
        <button
          type="button"
          aria-label="Next category"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const next = CATEGORIES[(activeIdx + 1) % CATEGORIES.length];
            setActiveCategory(next.key);
          }}
          className="shrink-0 rounded-md px-1 py-1 text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          ›
        </button>
      </div>

      <div
        className="max-h-80 overflow-y-auto px-1 py-1"
        role="listbox"
        aria-label={`${activeCat?.label ?? "results"} mentions`}
      >
        {loading && activeItems.length === 0 ? (
          <div className="flex items-center justify-center gap-2 p-6 text-xs text-zinc-500">
            <span className="inline-block h-3 w-3 rounded-full border-2 border-zinc-400/40 border-t-[#fe591f] animate-spin" />
            Loading {activeCat?.label.toLowerCase() ?? "results"}…
          </div>
        ) : activeItems.length === 0 ? (
          <div className="p-6 text-center text-xs text-zinc-500">
            <div>Nothing here yet.</div>
            <div className="mt-1 text-[10px] text-zinc-400">
              Try another category or clear your search.
            </div>
          </div>
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

      <div className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 px-3 py-1.5 text-[10px] text-zinc-500 dark:text-zinc-500 flex gap-3">
        <Hint label="navigate" keys={["↑", "↓"]} />
        <Hint label="select" keys={["↵"]} />
        <Hint label="next tab" keys={["⇥"]} />
        <Hint label="close" keys={["esc"]} />
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

function CategoryTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all whitespace-nowrap ${
        active
          ? "bg-white dark:bg-zinc-800 text-[#fe591f] ring-1 ring-[#fe591f]/20 shadow-sm"
          : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100/80 dark:hover:bg-zinc-800/60"
      }`}
    >
      {icon}
      {label}
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
    <div>
      {oss.length > 0 && (
        <>
          <BucketHeader label="Open Source · sports-skills" />
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
          <BucketHeader label="Machina · connectors & templates" />
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

function BucketHeader({ label }: { label: string }) {
  return (
    <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider font-semibold text-zinc-400 dark:text-zinc-500 flex items-center gap-2">
      <span>{label}</span>
      <span className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
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

const TYPE_BADGE_CLASS: Record<string, string> = {
  repo: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  job: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
  template:
    "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  workflow:
    "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400",
  agent:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  cmd: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  skill: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400",
  connector: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-400",
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
    <div className="space-y-0.5">
      {items.map((item, idx) => {
        const globalIdx = offset + idx;
        const isSelected = globalIdx === selectedIndex;
        const isChosen = selectedIds.has(item.id);
        const typeLabel = TYPE_LABEL[item.type] ?? item.type;
        const badgeClass = TYPE_BADGE_CLASS[item.type] ?? TYPE_BADGE_CLASS.repo;
        return (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={isSelected}
            // Prevent the click from blurring the editor — handleMentionSelect
            // reads window.getSelection() to find the `@` position, and that
            // selection is collapsed if focus moves to this button first.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(item)}
            onMouseEnter={() => onHover(globalIdx)}
            className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-md text-left transition-colors ${
              isSelected
                ? "bg-[#fe591f]/10 ring-1 ring-[#fe591f]/30"
                : "hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
            } ${isChosen ? "opacity-60" : ""}`}
          >
            <span
              className={`shrink-0 mt-0.5 ${
                isSelected ? "text-[#fe591f]" : "text-zinc-400"
              }`}
            >
              {item.icon}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`shrink-0 inline-flex items-center rounded-sm px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${badgeClass}`}
                >
                  {typeLabel}
                </span>
                <span
                  className={`text-sm truncate ${
                    isSelected
                      ? "text-zinc-900 dark:text-white font-medium"
                      : "text-zinc-700 dark:text-zinc-200"
                  }`}
                >
                  {item.title}
                </span>
              </div>
              {item.subtitle && (
                <div className="mt-0.5 text-[11px] text-zinc-500 truncate">
                  {item.subtitle}
                </div>
              )}
            </div>
            {isChosen && (
              <span className="shrink-0 text-[10px] text-zinc-400 italic mt-1">
                added
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
