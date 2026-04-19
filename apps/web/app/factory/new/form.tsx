"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChangeEvent } from "react";
import {
  BookOpen,
  GitBranch,
  ImagePlus,
  ListTodo,
  Loader2,
  Lock,
  Plus,
  Search,
  Sparkles,
  X,
  ChevronDown,
  ChevronRight,
  Zap,
  AtSign,
} from "lucide-react";
import { createJob } from "./actions";
import type { CreateJobState } from "./actions";
import { MentionPicker } from "./mention-picker";
import type { MentionItem } from "./mention-hooks";

const initialState: CreateJobState = { error: undefined };

const inputClass =
  "w-full rounded-md border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-[13px] text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 transition-colors focus:border-[#fe591f] focus:outline-none focus:ring-1 focus:ring-[#fe591f]";

const labelClass =
  "mb-1.5 block text-[12px] font-medium text-zinc-700 dark:text-zinc-300";

const sectionClass =
  "rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950";

interface OrgRepo {
  fullName: string;
  name: string;
  owner: string;
  defaultBranch: string;
  description: string | null;
  language: string | null;
  isPrivate: boolean;
}

interface SelectedRef {
  fullName: string;
  owner: string;
  name: string;
  branch: string;
  description: string | null;
  language: string | null;
  isPrivate: boolean;
}

interface AttachedImage {
  id: string;
  name: string;
  dataUrl: string;
  size: number;
}

function PrivateBadge() {
  return (
    <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-950/40 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
      <Lock className="h-2.5 w-2.5" />
      Private
    </span>
  );
}

export interface FormPrefill {
  repoOwner?: string;
  repoName?: string;
  baseBranch?: string;
  workBranch?: string;
  modelId?: string;
  referenceRepos?: Array<{
    repoOwner: string;
    repoName: string;
    branch?: string;
  }>;
  continueFrom?: string;
  prevTask?: string;
  studioCtxToken?: string;
  studioProjectName?: string;
}

type Mode = "existing" | "create";

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

function readEditor(
  root: HTMLElement,
  chipRegistry: Map<string, MentionItem>,
): { text: string; chips: MentionItem[] } {
  let text = "";
  const chips: MentionItem[] = [];
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
    } else if (node instanceof HTMLElement) {
      const chipId = node.dataset.chipId;
      if (chipId) {
        const item = chipRegistry.get(chipId);
        if (item) {
          chips.push(item);
          text += `@${item.type}:${item.title}`;
        }
      } else if (node.tagName === "BR") {
        text += "\n";
      } else {
        text += node.textContent ?? node.textContent ?? "";
      }
    }
  }
  return { text, chips };
}

function buildChipElement(
  chipId: string,
  item: MentionItem,
  onRemove: (id: string) => void,
): HTMLSpanElement {
  const span = document.createElement("span");
  span.contentEditable = "false";
  span.dataset.chipId = chipId;
  span.className =
    "inline-flex items-center gap-1 mx-0.5 rounded bg-[#fe591f]/10 text-[#fe591f] border border-[#fe591f]/25 px-1.5 py-0.5 text-[12px] font-mono align-baseline select-none";

  const typeSpan = document.createElement("span");
  typeSpan.className = "opacity-60";
  typeSpan.textContent = `${item.type}:`;
  span.appendChild(typeSpan);

  const titleSpan = document.createElement("span");
  titleSpan.textContent = item.title;
  span.appendChild(titleSpan);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className =
    "ml-0.5 rounded-full p-0.5 hover:bg-[#fe591f]/20 transition-colors inline-flex items-center justify-center";
  btn.setAttribute("aria-label", `Remove mention ${item.title}`);
  btn.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    onRemove(chipId);
  });
  span.appendChild(btn);

  return span;
}

export function NewJobForm({ prefill }: { prefill?: FormPrefill }) {
  const [state, formAction, pending] = useActionState(createJob, initialState);
  const isContinuation = Boolean(prefill?.continueFrom);
  const [mode, setMode] = useState<Mode>("existing");
  const [planMode, setPlanMode] = useState<boolean>(!isContinuation);
  const [refs, setRefs] = useState<SelectedRef[]>(() => {
    if (!prefill?.referenceRepos) return [];
    return prefill.referenceRepos.map((r) => ({
      fullName: `${r.repoOwner}/${r.repoName}`,
      owner: r.repoOwner,
      name: r.repoName,
      branch: r.branch ?? "main",
      description: null,
      language: null,
      isPrivate: false,
    }));
  });
  const [showRepoSearch, setShowRepoSearch] = useState(false);
  const [fromRepo, setFromRepo] = useState<SelectedRef | null>(null);
  const [showFromSearch, setShowFromSearch] = useState(false);
  const [targetRepo, setTargetRepo] = useState<SelectedRef | null>(() => {
    if (prefill?.repoOwner && prefill?.repoName) {
      return {
        fullName: `${prefill.repoOwner}/${prefill.repoName}`,
        owner: prefill.repoOwner,
        name: prefill.repoName,
        branch: prefill.baseBranch ?? "main",
        description: null,
        language: null,
        isPrivate: false,
      };
    }
    return null;
  });
  const [showTargetSearch, setShowTargetSearch] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(prefill?.modelId) ||
      Boolean(prefill?.baseBranch && prefill.baseBranch !== "main"),
  );

  const editorRef = useRef<HTMLDivElement>(null);
  const inputAreaRef = useRef<HTMLDivElement>(null);
  const chipRegistryRef = useRef<Map<string, MentionItem>>(new Map());

  const [activeChips, setActiveChips] = useState<MentionItem[]>([]);
  const [taskText, setTaskText] = useState("");
  const [editorIsEmpty, setEditorIsEmpty] = useState(true);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerAnchor, setPickerAnchor] = useState<{
    top: number;
    left: number;
  }>({ top: 0, left: 0 });

  const [images, setImages] = useState<AttachedImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const syncFromEditor = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;
    const { text, chips } = readEditor(root, chipRegistryRef.current);
    setTaskText(text);
    setActiveChips(chips);
    setEditorIsEmpty(root.childNodes.length === 0 || text === "");

    const aliveIds = new Set<string>();
    for (const node of Array.from(
      root.querySelectorAll<HTMLElement>("[data-chip-id]"),
    )) {
      const id = node.dataset.chipId;
      if (id) aliveIds.add(id);
    }
    for (const key of Array.from(chipRegistryRef.current.keys())) {
      if (!aliveIds.has(key)) chipRegistryRef.current.delete(key);
    }
  }, []);

  const detectMentionTrigger = useCallback(() => {
    const root = editorRef.current;
    if (!root || document.activeElement !== root) {
      setPickerOpen(false);
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      setPickerOpen(false);
      return;
    }
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) {
      setPickerOpen(false);
      return;
    }
    if (!root.contains(node)) {
      setPickerOpen(false);
      return;
    }
    const text = node.textContent ?? "";
    const caret = range.startOffset;

    let atPos = -1;
    for (let i = caret - 1; i >= 0; i--) {
      const ch = text[i];
      if (ch === "@") {
        atPos = i;
        break;
      }
      if (/\s/.test(ch)) break;
    }

    if (atPos === -1) {
      setPickerOpen(false);
      return;
    }

    const query = text.slice(atPos + 1, caret);

    const probe = document.createRange();
    probe.setStart(node, atPos);
    probe.setEnd(node, atPos);
    const rect = probe.getBoundingClientRect();
    const parent = inputAreaRef.current?.getBoundingClientRect();
    if (!parent || (!rect.width && !rect.height && !rect.top)) {
      const edit = root.getBoundingClientRect();
      setPickerAnchor({ top: edit.bottom - parent!.top + 4, left: 8 });
    } else {
      setPickerAnchor({
        top: rect.bottom - parent.top + 4,
        left: Math.max(0, rect.left - parent.left),
      });
    }
    setPickerQuery(query);
    setPickerOpen(true);
  }, []);

  const handleEditorInput = useCallback(() => {
    syncFromEditor();
    requestAnimationFrame(detectMentionTrigger);
  }, [syncFromEditor, detectMentionTrigger]);

  const handleSelectionChange = useCallback(() => {
    if (document.activeElement !== editorRef.current) return;
    detectMentionTrigger();
  }, [detectMentionTrigger]);

  useEffect(() => {
    document.addEventListener("selectionchange", handleSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", handleSelectionChange);
  }, [handleSelectionChange]);

  const removeChipFromDom = useCallback(
    (chipId: string) => {
      const root = editorRef.current;
      if (!root) return;
      const el = root.querySelector<HTMLElement>(
        `[data-chip-id="${CSS.escape(chipId)}"]`,
      );
      if (el) {
        el.remove();
        chipRegistryRef.current.delete(chipId);
        syncFromEditor();
      }
    },
    [syncFromEditor],
  );

  const activeChipIds = useMemo(
    () => new Set(activeChips.map((c) => c.id)),
    [activeChips],
  );

  const handleMentionSelect = (item: MentionItem) => {
    if (activeChipIds.has(item.id)) {
      setPickerOpen(false);
      editorRef.current?.focus();
      return;
    }

    const sel = window.getSelection();
    const root = editorRef.current;
    if (!sel || sel.rangeCount === 0 || !root) {
      setPickerOpen(false);
      return;
    }
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE || !root.contains(node)) {
      setPickerOpen(false);
      return;
    }
    const caret = range.startOffset;
    const text = node.textContent ?? "";

    let atPos = -1;
    for (let i = caret - 1; i >= 0; i--) {
      const ch = text[i];
      if (ch === "@") {
        atPos = i;
        break;
      }
      if (/\s/.test(ch)) break;
    }
    if (atPos === -1) {
      setPickerOpen(false);
      return;
    }

    const delRange = document.createRange();
    delRange.setStart(node, atPos);
    delRange.setEnd(node, caret);
    delRange.deleteContents();

    const insertRange = document.createRange();
    insertRange.setStart(node, atPos);
    insertRange.setEnd(node, atPos);

    if (item.type === "cmd") {
      const fence = `\`${item.title}\`\u00A0`;
      const textNode = document.createTextNode(fence);
      insertRange.insertNode(textNode);
      const placeholderIdx = item.title.indexOf("<");
      const newRange = document.createRange();
      if (placeholderIdx >= 0) {
        newRange.setStart(textNode, placeholderIdx + 1);
        const endIdx = item.title.indexOf(">", placeholderIdx);
        newRange.setEnd(
          textNode,
          endIdx >= 0 ? endIdx + 2 : placeholderIdx + 1,
        );
      } else {
        newRange.setStartAfter(textNode);
        newRange.collapse(true);
      }
      sel.removeAllRanges();
      sel.addRange(newRange);
    } else {
      const chipId = genId();
      chipRegistryRef.current.set(chipId, item);
      const chipEl = buildChipElement(chipId, item, removeChipFromDom);

      const afterTextNode = document.createTextNode("\u00A0");
      insertRange.insertNode(afterTextNode);
      insertRange.insertNode(chipEl);

      const newRange = document.createRange();
      newRange.setStartAfter(afterTextNode);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
    }

    if (item.type === "repo" && mode === "existing") {
      const r = item.data as OrgRepo;
      if (!targetRepo) {
        setTargetRepo({
          fullName: r.fullName,
          owner: r.owner,
          name: r.name,
          branch: r.defaultBranch,
          description: r.description,
          language: r.language,
          isPrivate: r.isPrivate,
        });
      } else {
        addRef(r);
      }
    }

    setPickerOpen(false);
    setPickerQuery("");
    syncFromEditor();
  };

  function addRef(repo: OrgRepo) {
    if (refs.some((r) => r.fullName === repo.fullName)) return;
    setRefs((prev) => [
      ...prev,
      {
        fullName: repo.fullName,
        owner: repo.owner,
        name: repo.name,
        branch: repo.defaultBranch,
        description: repo.description,
        language: repo.language,
        isPrivate: repo.isPrivate,
      },
    ]);
    setShowRepoSearch(false);
  }

  function removeRef(index: number) {
    setRefs((prev) => prev.filter((_, i) => i !== index));
  }

  function pickFromRepo(repo: OrgRepo) {
    setFromRepo({
      fullName: repo.fullName,
      owner: repo.owner,
      name: repo.name,
      branch: repo.defaultBranch,
      description: repo.description,
      language: repo.language,
      isPrivate: repo.isPrivate,
    });
    setShowFromSearch(false);
  }

  async function handleImagePick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setImages((prev) => [
        ...prev,
        { id: genId(), name: file.name, dataUrl, size: file.size },
      ]);
    }
  }

  function removeImage(id: string) {
    setImages((prev) => prev.filter((i) => i.id !== id));
  }

  const structuredRefs = refs.map((r) => ({
    repoOwner: r.owner,
    repoName: r.name,
    branch: r.branch,
  }));

  const serializedAttachments = images.map((img) => ({
    type: "image" as const,
    name: img.name,
    dataUrl: img.dataUrl,
  }));

  return (
    <form action={formAction} className="space-y-5">
      {state.error && (
        <div className="rounded-lg border border-red-300 dark:border-red-800/50 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-sm text-red-600 dark:text-red-300">
          {state.error}
        </div>
      )}

      {/* Hidden inputs — preserve the exact contract with createJob() */}
      <input type="hidden" name="task" value={taskText} />
      <input
        type="hidden"
        name="referenceRepos"
        value={JSON.stringify(structuredRefs)}
      />
      <input type="hidden" name="repoMode" value={mode} />
      {images.length > 0 && (
        <input
          type="hidden"
          name="attachments"
          value={JSON.stringify(serializedAttachments)}
        />
      )}
      {isContinuation && prefill?.continueFrom && (
        <>
          <input
            type="hidden"
            name="parentJobId"
            value={prefill.continueFrom}
          />
          <input type="hidden" name="origin" value="continuation" />
        </>
      )}
      {activeChips
        .filter((c) => c.type === "job")
        .map((c, i) => (
          <input
            key={`job-${i}`}
            type="hidden"
            name="parentJobId"
            value={c.id}
          />
        ))}

      {mode === "create" && fromRepo && (
        <input
          type="hidden"
          name="fromRepo"
          value={JSON.stringify({
            repoOwner: fromRepo.owner,
            repoName: fromRepo.name,
            branch: fromRepo.branch,
          })}
        />
      )}
      {prefill?.workBranch && (
        <input type="hidden" name="workBranch" value={prefill.workBranch} />
      )}
      {prefill?.studioCtxToken && (
        <input
          type="hidden"
          name="studioCtxToken"
          value={prefill.studioCtxToken}
        />
      )}

      {prefill?.studioProjectName && (
        <div className="rounded-lg border border-[#fe591f]/30 bg-[#fe591f]/5 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-200 flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[#fe591f]" />
          <span>
            Working inside project{" "}
            <strong className="font-medium text-[#fe591f]">
              {prefill.studioProjectName}
            </strong>
          </span>
        </div>
      )}

      {!isContinuation && (
        <PromptStarters
          projectName={prefill?.studioProjectName}
          onPick={(text) => {
            const root = editorRef.current;
            if (!root) return;
            chipRegistryRef.current.clear();
            root.textContent = text;
            const range = document.createRange();
            range.selectNodeContents(root);
            range.collapse(false);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
            root.focus();
            syncFromEditor();
          }}
        />
      )}

      {/* Task editor */}
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <label className="text-[12px] font-medium text-zinc-700 dark:text-zinc-300">
            Task <span className="text-red-400">*</span>
          </label>
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">
            {taskText.length > 0 && `${taskText.length} chars`}
          </span>
        </div>

        <div
          ref={inputAreaRef}
          className="relative w-full rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-950 transition-colors focus-within:border-[#fe591f] focus-within:ring-1 focus-within:ring-[#fe591f] shadow-sm"
        >
          {/** biome-ignore lint/a11y/useFocusableInteractive: contenteditable */}
          {/** biome-ignore lint/a11y/noStaticElementInteractions: contenteditable */}
          <div
            ref={editorRef}
            role="textbox"
            aria-label="Task description"
            aria-multiline="true"
            contentEditable
            suppressContentEditableWarning
            onInput={handleEditorInput}
            onKeyDown={(e) => {
              if (
                pickerOpen &&
                ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(
                  e.key,
                )
              ) {
                e.preventDefault();
              }
            }}
            className="min-h-[120px] max-h-[260px] overflow-y-auto w-full px-3.5 py-3 text-[13px] leading-relaxed text-zinc-900 dark:text-zinc-100 focus:outline-none whitespace-pre-wrap break-words"
          />
          {editorIsEmpty && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-3 left-3.5 text-[13px] text-zinc-400 dark:text-zinc-500"
            >
              Describe what the agent should do — type{" "}
              <span className="font-mono text-[#fe591f]/70">@</span> to mention
              a repo, skill, or connector
            </div>
          )}

          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pb-2">
              {images.map((img) => (
                <div
                  key={img.id}
                  className="group relative inline-flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 pl-1 pr-2 py-1"
                >
                  {/** biome-ignore lint/performance/noImgElement: base64 preview */}
                  {/** biome-ignore lint/nursery/useImageSize: base64 preview */}
                  <img
                    src={img.dataUrl}
                    alt={img.name}
                    className="h-8 w-8 rounded object-cover"
                  />
                  <span className="text-xs text-zinc-600 dark:text-zinc-300 truncate max-w-[120px]">
                    {img.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeImage(img.id)}
                    className="rounded-full p-0.5 text-zinc-400 hover:bg-red-500/10 hover:text-red-500 transition-colors"
                    aria-label={`Remove ${img.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1 border-t border-zinc-200/70 dark:border-zinc-800/70 px-2 py-1.5 bg-zinc-50/50 dark:bg-zinc-900/30 rounded-b-xl">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="Attach screenshot"
            >
              <ImagePlus className="h-3.5 w-3.5" />
              Attach
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImagePick}
              className="hidden"
            />
            <span className="ml-auto text-[11px] text-zinc-400 dark:text-zinc-500 flex items-center gap-2">
              <span className="inline-flex items-center gap-1">
                <AtSign className="h-3 w-3" />
                mention
              </span>
              {activeChips.length > 0 && (
                <span className="text-[#fe591f]">
                  {activeChips.length} selected
                </span>
              )}
              {images.length > 0 && (
                <span>
                  {images.length} image{images.length > 1 ? "s" : ""}
                </span>
              )}
            </span>
          </div>

          {pickerOpen && (
            <MentionPicker
              query={pickerQuery}
              position={pickerAnchor}
              onSelect={handleMentionSelect}
              onClose={() => setPickerOpen(false)}
              selectedIds={activeChipIds}
            />
          )}
        </div>
      </div>

      {/* Plan mode */}
      <label
        htmlFor="executionMode"
        className="flex items-center gap-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30 px-3 py-2 text-[13px] text-zinc-700 dark:text-zinc-300 cursor-pointer select-none hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
      >
        <input
          type="checkbox"
          id="executionMode"
          name="executionMode"
          value="plan"
          checked={planMode}
          onChange={(e) => setPlanMode(e.target.checked)}
          className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700 text-[#fe591f] focus:ring-[#fe591f]"
        />
        <ListTodo className="h-3.5 w-3.5 text-zinc-400" />
        <span className="font-medium">Review plan before running</span>
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500 ml-auto">
          recommended
        </span>
      </label>

      {!isContinuation && (
        <div className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100/60 dark:bg-zinc-900 p-0.5 text-sm">
          <SegmentButton
            active={mode === "existing"}
            onClick={() => setMode("existing")}
            icon={<GitBranch className="h-3.5 w-3.5" />}
            label="Existing repo"
          />
          <SegmentButton
            active={mode === "create"}
            onClick={() => setMode("create")}
            icon={<Sparkles className="h-3.5 w-3.5" />}
            label="New repo"
          />
        </div>
      )}

      {mode === "existing" && (
        <div className={`${sectionClass} p-4 space-y-3`}>
          <div className="flex items-baseline justify-between">
            <div className="text-[12px] font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <GitBranch className="h-3.5 w-3.5 text-zinc-400" />
              Target Repository <span className="text-red-400">*</span>
            </div>
          </div>
          <input
            type="hidden"
            name="repoOwner"
            value={targetRepo?.owner ?? ""}
          />
          <input
            type="hidden"
            name="repoName"
            value={targetRepo?.name ?? ""}
          />

          {targetRepo ? (
            <RepoCard
              repo={targetRepo}
              onRemove={() => setTargetRepo(null)}
            />
          ) : showTargetSearch ? (
            <RepoSearchDropdown
              selectedFullNames={[]}
              onSelect={(repo) => {
                setTargetRepo({
                  fullName: repo.fullName,
                  owner: repo.owner,
                  name: repo.name,
                  branch: repo.defaultBranch,
                  description: repo.description,
                  language: repo.language,
                  isPrivate: repo.isPrivate,
                });
                setShowTargetSearch(false);
              }}
              onClose={() => setShowTargetSearch(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowTargetSearch(true)}
              className="w-full rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/30 px-3 py-2.5 text-[13px] text-zinc-500 dark:text-zinc-400 transition-colors hover:border-[#fe591f] hover:text-[#fe591f]"
            >
              Pick the repo to work in…
            </button>
          )}

          <div className="pt-1 border-t border-zinc-200/60 dark:border-zinc-800/60">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 mt-2"
            >
              {showAdvanced ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Advanced
              {!showAdvanced && (
                <span className="text-zinc-400 dark:text-zinc-500 font-normal ml-1">
                  base branch · model override
                </span>
              )}
            </button>
            {showAdvanced && (
              <div className="grid grid-cols-2 gap-4 mt-3">
                <div>
                  <label htmlFor="baseBranch" className={labelClass}>
                    Base Branch
                  </label>
                  <input
                    id="baseBranch"
                    name="baseBranch"
                    type="text"
                    defaultValue={
                      prefill?.baseBranch ?? targetRepo?.branch ?? "main"
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="modelId" className={labelClass}>
                    Model
                  </label>
                  <input
                    id="modelId"
                    name="modelId"
                    type="text"
                    defaultValue={prefill?.modelId ?? ""}
                    placeholder="google/gemini-3.1-pro-preview"
                    className={inputClass}
                  />
                  <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">
                    Leave blank to use the environment default.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {mode === "create" && (
        <div className={`${sectionClass} p-4 space-y-4`}>
          <h3 className="text-[12px] font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-[#fe591f]" />
            New Repository
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="newRepoOrg" className={labelClass}>
                Organization
              </label>
              <input
                id="newRepoOrg"
                name="newRepoOrg"
                type="text"
                defaultValue="machina-sports"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="newRepoName" className={labelClass}>
                New Repo Name <span className="text-red-400">*</span>
              </label>
              <input
                id="newRepoName"
                name="newRepoName"
                type="text"
                required={mode === "create"}
                placeholder="my-new-site"
                pattern="[a-zA-Z0-9._\-]+"
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <div className={labelClass}>
              Scaffold From <span className="text-red-400">*</span>
            </div>
            {fromRepo ? (
              <RepoCard repo={fromRepo} onRemove={() => setFromRepo(null)} />
            ) : showFromSearch ? (
              <RepoSearchDropdown
                selectedFullNames={[]}
                onSelect={pickFromRepo}
                onClose={() => setShowFromSearch(false)}
              />
            ) : (
              <button
                type="button"
                onClick={() => setShowFromSearch(true)}
                className="w-full rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/30 px-3 py-2.5 text-[13px] text-zinc-500 dark:text-zinc-400 transition-colors hover:border-[#fe591f] hover:text-[#fe591f]"
              >
                Pick a base repo to scaffold from…
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="modelIdCreate" className={labelClass}>
                Model
              </label>
              <input
                id="modelIdCreate"
                name="modelId"
                type="text"
                defaultValue={
                  prefill?.modelId ?? "google/gemini-3.1-pro-preview"
                }
                className={inputClass}
              />
            </div>
            <label className="flex items-end gap-2 pb-2.5">
              <input
                type="checkbox"
                name="newRepoPrivate"
                defaultChecked
                className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700 text-[#fe591f] focus:ring-[#fe591f]"
              />
              <span className="text-[13px] text-zinc-700 dark:text-zinc-300 inline-flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5" />
                Private repo
              </span>
            </label>
          </div>

          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            We&apos;ll create <code className="font-mono">{`<org>/<name>`}</code>,
            copy all files from the base repo as the initial commit (no
            history), then run the agent on it.
          </p>
        </div>
      )}

      {/* Reference repos */}
      <div
        className={`${sectionClass} ${
          refs.length > 0 || showRepoSearch ? "p-4 space-y-3" : "px-4 py-2.5"
        }`}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-[12px] font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5 text-zinc-400" />
            Reference Repos
            {refs.length > 0 && (
              <span className="rounded-full bg-[#fe591f]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#fe591f]">
                {refs.length}
              </span>
            )}
            {refs.length === 0 && !showRepoSearch && (
              <span className="text-[11px] font-normal text-zinc-400 dark:text-zinc-500">
                — optional, gives the agent more context
              </span>
            )}
          </h3>
          <button
            type="button"
            onClick={() => setShowRepoSearch(true)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[#fe591f] transition-colors hover:bg-[#fe591f]/10"
          >
            <Plus className="h-3 w-3" />
            Add
          </button>
        </div>

        {refs.length > 0 && (
          <div className="space-y-2">
            {refs.map((ref, i) => (
              <RepoCard
                key={ref.fullName}
                repo={ref}
                onRemove={() => removeRef(i)}
              />
            ))}
          </div>
        )}

        {showRepoSearch && (
          <RepoSearchDropdown
            selectedFullNames={refs.map((r) => r.fullName)}
            onSelect={addRef}
            onClose={() => setShowRepoSearch(false)}
          />
        )}
      </div>

      {/* Submit */}
      <div className="sticky bottom-0 pt-2 pb-1 -mx-1 px-1 bg-gradient-to-t from-white via-white to-transparent dark:from-zinc-950 dark:via-zinc-950">
        <button
          type="submit"
          disabled={pending}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#fe591f] px-4 py-3 text-[13px] font-medium text-white transition-all hover:bg-[#fe591f]/90 disabled:cursor-not-allowed disabled:opacity-50 shadow-[0_1px_0_rgba(255,255,255,0.15)_inset,0_8px_20px_-8px_rgba(254,89,31,0.5)]"
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating…
            </>
          ) : prefill?.continueFrom ? (
            "Continue job"
          ) : planMode ? (
            <>
              <ListTodo className="h-4 w-4" />
              Draft plan for review
            </>
          ) : (
            <>
              <Zap className="h-4 w-4" />
              Run agent now
            </>
          )}
        </button>
      </div>
    </form>
  );
}

function RepoCard({
  repo,
  onRemove,
}: {
  repo: SelectedRef;
  onRemove: () => void;
}) {
  return (
    <div className="group flex items-center gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/50 px-3 py-2.5 transition-colors hover:border-zinc-300 dark:hover:border-zinc-700">
      <GitBranch className="h-4 w-4 shrink-0 text-zinc-400" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 truncate">
            {repo.fullName}
          </span>
          {repo.isPrivate && <PrivateBadge />}
          {repo.language && (
            <span className="shrink-0 rounded-full bg-zinc-200/60 dark:bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
              {repo.language}
            </span>
          )}
        </div>
        {repo.description && (
          <p className="text-[11px] text-zinc-500 truncate mt-0.5">
            {repo.description}
          </p>
        )}
      </div>
      <span className="shrink-0 rounded-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-2 py-0.5 font-mono text-[11px] text-zinc-500">
        {repo.branch}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 rounded-md p-1 text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/10 hover:text-red-500"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function SegmentButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-all ${
        active
          ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm ring-1 ring-zinc-200 dark:ring-zinc-700"
          : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
      }`}
    >
      <span className={active ? "text-[#fe591f]" : ""}>{icon}</span>
      {label}
    </button>
  );
}

function RepoSearchDropdown({
  selectedFullNames,
  onSelect,
  onClose,
}: {
  selectedFullNames: string[];
  onSelect: (repo: OrgRepo) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [repos, setRepos] = useState<OrgRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchRepos = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ org: "machina-sports" });
      if (q) params.set("q", q);
      const res = await fetch(`/factory/api/github/repos?${params}`);
      const data = await res.json();
      setRepos(data.repos ?? []);
    } catch {
      setRepos([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRepos("");
    inputRef.current?.focus();
  }, [fetchRepos]);

  useEffect(() => {
    const timer = setTimeout(() => fetchRepos(query), 200);
    return () => clearTimeout(timer);
  }, [query, fetchRepos]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const filtered = repos.filter((r) => !selectedFullNames.includes(r.fullName));

  return (
    <div
      ref={containerRef}
      className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 shadow-lg overflow-hidden"
    >
      <div className="relative border-b border-zinc-200 dark:border-zinc-800">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search repositories…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-transparent px-3 py-2.5 pl-9 text-[13px] text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-zinc-400" />
        )}
      </div>
      <div className="max-h-64 overflow-y-auto">
        {filtered.length === 0 && !loading && (
          <p className="px-4 py-6 text-center text-xs text-zinc-400">
            No repositories found
          </p>
        )}
        {filtered.map((repo) => (
          <button
            key={repo.fullName}
            type="button"
            onClick={() => onSelect(repo)}
            className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            <GitBranch className="h-4 w-4 shrink-0 text-zinc-400" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 truncate">
                  {repo.fullName}
                </span>
                {repo.isPrivate && <PrivateBadge />}
                {repo.language && (
                  <span className="shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                    {repo.language}
                  </span>
                )}
              </div>
              {repo.description && (
                <p className="text-[11px] text-zinc-500 truncate">
                  {repo.description}
                </p>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

interface Starter {
  title: string;
  subtitle: string;
  prompt: string;
}

function buildStarters(_projectName?: string): Starter[] {
  // NOTE: this list is unchanged from the previous implementation —
  // re-copied from the original form.tsx at HEAD. See docs/PROMPT-EXAMPLES.md.
  return [
    {
      title: "Agent template from scratch",
      subtitle: "Connector + workflow + prompt, end to end",
      prompt: `Create a new agent template called "match-previewer" in the agent-templates/ directory.

## What it does
This agent generates pre-match preview content for football (soccer) matches. Given a match ID from api-football, it fetches team stats, recent form, head-to-head history, and generates a rich preview article.

## Connector
Create a REST connector called "api-football-stats" that calls the API-Football v3 API:
- Base URL: https://v3.football.api-sports.com
- Auth: x-apisports-key header from vault
- Endpoints: GET /fixtures (by id), GET /fixtures/headtohead, GET /teams/statistics

## Workflow
Create "match-preview-workflow" with steps:
1. fetch-fixture — get match details
2. fetch-h2h — get head-to-head history
3. fetch-home-stats — get home team season stats
4. fetch-away-stats — get away team season stats
5. generate-preview — use google-genai to write the preview article

## Important Machina patterns
- Workflow commands use method-path format: get-fixtures, get-fixtures/headtohead
- Literal string inputs need inner quotes: "'show'" not "show"
- context-variables map vault secrets: api_key: "$TEMP_CONTEXT_VARIABLE_API_FOOTBALL_KEY"
- workflow-status is required in outputs
- Bearer auth uses basicAuth scheme name in the connector schema

## Template structure
Follow _install.yml patterns from .refs/ reference repos.`,
    },
    {
      title: "New REST API connector",
      subtitle: "OpenAPI schema + auth + sample endpoints",
      prompt: `Create a new REST API connector for the Spotify Web API in agent-templates/spotify-agent/connectors/.

## Connector spec
- Name: spotify-api
- Base URL: https://api.spotify.com/v1
- Auth: Bearer token via basicAuth scheme (Machina pattern for Bearer auth)
- filetype: restapi

## Endpoints (OpenAPI 3.0.3)
1. GET /search — Search for shows, episodes, tracks
   Params: q (query), type (query), market (query), limit (query)
2. GET /shows/{show_id}/episodes — Get show episodes
   Params: show_id (path), market (query), limit (query)

## Important
- securitySchemes must use "basicAuth" as the key name (not "bearer")
- scheme must be "Bearer" (capital B)
- All endpoints need security: [{"basicAuth": []}]

Create both the YAML descriptor and the JSON schema file.`,
    },
    {
      title: "Fix a failing workflow",
      subtitle: "Diagnose runtime errors, minimal edits",
      prompt: `Fix the workflow at agent-templates/my-agent/workflows/main-workflow.yml.

The workflow fails with error: "'str' object has no attribute 'get'"

## Root cause analysis
This error means the REST connector response is being returned as a string instead of a parsed dict. Common causes:
1. Bearer auth not reaching the API (check basicAuth scheme name)
2. Literal string inputs not quoted (use "'value'" not "value")
3. json.loads() in outputs (not supported — use simple $.get())

## What to check
1. context-variables: vault key names must match exactly
2. connector command format: must be method-path (e.g., get-search, post-chat/completions)
3. task inputs: literal strings need inner quotes
4. task outputs: only $.get() expressions, no json.loads()

Fix only what's broken. Do not rewrite the entire file.`,
    },
    {
      title: "Frontend from boilerplate",
      subtitle: "Next.js UI wired to a Machina agent",
      prompt: `Create a Next.js frontend for the podcast-digest agent.

## Setup
1. Copy the frontend boilerplate from .refs/machina-sports-machina-frontend-boilerplate/
2. Customize for the podcast digest use case

## Pages
- Home page: Search input for podcast topic, "Generate Digest" button
- Results page: Display the generated digest in formatted Markdown
- History page: List of previous digests

## API Integration
- POST /api/digest — calls the Machina client-api agent executor
- GET /api/history — fetches recent executions

## Design
- Use the Machina brand colors (#fe591f primary)
- Dark mode support
- Mobile responsive
- Loading states with skeleton UI

The frontend should be in a separate directory: frontend-podcast-digest/`,
    },
    {
      title: "Helper script to run a workflow",
      subtitle: "CLI alias, Makefile, or script to invoke an agent/workflow",
      prompt: `Add a helper script to the repo that makes it easy to run a Machina workflow (or agent, or installed template) from a terminal. Factory only ships code — this task is to CREATE the helper, not to run anything.

## Required
- A \`scripts/run-<name>.sh\` (or .py) that wraps \`machina workflow run <name>\` / \`machina agent run <name>\` / \`machina template install <name>\`
- Takes inputs as --flags or positional args, forwards them as \`key=value\` to the underlying command
- Pretty-prints the JSON result (or streams tokens when --watch is set)
- Exits non-zero on failure so it's CI-friendly

## Integrations
- If the repo has a Makefile, add a \`make run-<name> ARGS=...\` target that calls the script.
- If the repo is a Python/Node project, also expose the helper as a package script (package.json or pyproject entry point) so contributors can run \`npm run run-<name>\` / \`uv run run-<name>\`.

## Docs
- Append a "Running locally" section to the repo README with a minimal example invocation.`,
    },
  ];
}

function PromptStarters({
  projectName,
  onPick,
}: {
  projectName?: string;
  onPick: (prompt: string) => void;
}) {
  const starters = useMemo(() => buildStarters(projectName), [projectName]);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-zinc-500 dark:text-zinc-400">
          Start from an example
        </div>
        <div className="text-[10px] text-zinc-400 dark:text-zinc-500">
          {starters.length} prompts
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {starters.map((s) => (
          <button
            key={s.title}
            type="button"
            onClick={() => onPick(s.prompt)}
            className="group text-left rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2.5 transition-all hover:border-[#fe591f]/40 hover:bg-[#fe591f]/[0.03] hover:shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-medium text-zinc-900 dark:text-zinc-100 truncate group-hover:text-[#fe591f]">
                  {s.title}
                </div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                  {s.subtitle}
                </div>
              </div>
              <Plus className="h-3.5 w-3.5 shrink-0 text-zinc-300 dark:text-zinc-600 mt-0.5 group-hover:text-[#fe591f] transition-colors" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

