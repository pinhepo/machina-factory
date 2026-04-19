"use client";

import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import {
  GitBranch,
  CheckCircle,
  XCircle,
  Clock,
  BookOpen,
  Sparkles,
  Terminal,
  ListTodo,
  Bot,
  Database,
  Radio,
  BarChart3,
  FileText,
  Palette,
  Megaphone,
  Send,
} from "lucide-react";

export type MentionType =
  | "repo"
  | "job"
  | "template"
  | "workflow"
  | "agent"
  | "cmd"
  | "skill"
  | "connector";

export interface MentionItem {
  id: string;
  type: MentionType;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  data: unknown;
  /** Which category this item belongs to in the picker */
  category: CategoryKey;
  /** Which bucket inside the category (OSS vs Machina) */
  bucket?: BucketKey;
}

export type CategoryKey =
  | "code"
  | "sports-data"
  | "content-ai"
  | "publishing"
  | "commands";

export type BucketKey = "oss" | "machina";

export interface CategoryDef {
  key: CategoryKey;
  label: string;
  icon: ReactNode;
  hasBuckets: boolean;
}

export const CATEGORIES: CategoryDef[] = [
  {
    key: "code",
    label: "Code",
    icon: <GitBranch className="h-3.5 w-3.5" />,
    hasBuckets: false,
  },
  {
    key: "sports-data",
    label: "Sports Data",
    icon: <BarChart3 className="h-3.5 w-3.5" />,
    hasBuckets: true,
  },
  {
    key: "content-ai",
    label: "Content & AI",
    icon: <Palette className="h-3.5 w-3.5" />,
    hasBuckets: true,
  },
  {
    key: "publishing",
    label: "Publishing",
    icon: <Megaphone className="h-3.5 w-3.5" />,
    hasBuckets: true,
  },
  {
    key: "commands",
    label: "Commands",
    icon: <Terminal className="h-3.5 w-3.5" />,
    hasBuckets: false,
  },
];

// Curated open-source skills from machina-sports/sports-skills-like OSS inventory.
const OSS_SPORTS_SKILLS = [
  {
    id: "nba-scores",
    title: "nba-scores",
    subtitle: "Live NBA scores & box scores",
  },
  {
    id: "nba-schedule",
    title: "nba-schedule",
    subtitle: "Upcoming NBA games",
  },
  {
    id: "nfl-play-by-play",
    title: "nfl-play-by-play",
    subtitle: "NFL live play-by-play feed",
  },
  {
    id: "soccer-fixtures",
    title: "soccer-fixtures",
    subtitle: "Soccer fixtures across leagues",
  },
  {
    id: "f1-results",
    title: "f1-results",
    subtitle: "Formula 1 race results",
  },
];

// Curated Machina-native sports connectors from the machina-templates registry.
const MACHINA_SPORTS_CONNECTORS = [
  {
    id: "sportradar",
    title: "SportRadar",
    subtitle: "NBA, NFL, NHL, MLB, Soccer feeds",
  },
  {
    id: "stats-perform",
    title: "Stats Perform",
    subtitle: "Player & match stats",
  },
  { id: "opta", title: "Opta", subtitle: "Soccer event data" },
  {
    id: "api-football",
    title: "API Football",
    subtitle: "Football fixtures & stats",
  },
  {
    id: "covers",
    title: "Covers",
    subtitle: "Odds & standings scraper",
  },
];

// Curated OSS content/AI skills
const OSS_CONTENT_SKILLS = [
  {
    id: "article-generator",
    title: "article-generator",
    subtitle: "Long-form article generation",
  },
  {
    id: "summarizer",
    title: "summarizer",
    subtitle: "Text summarization",
  },
  {
    id: "transcript-to-highlights",
    title: "transcript-to-highlights",
    subtitle: "Video/audio highlights extraction",
  },
  {
    id: "image-ranker",
    title: "image-ranker",
    subtitle: "Rank images by relevance",
  },
];

// Curated Machina content/AI connectors
const MACHINA_CONTENT_CONNECTORS = [
  { id: "openai", title: "OpenAI", subtitle: "GPT models via connector" },
  {
    id: "anthropic",
    title: "Anthropic",
    subtitle: "Claude models via connector",
  },
  {
    id: "google-genai",
    title: "Google GenAI",
    subtitle: "Gemini via Vertex AI",
  },
  {
    id: "imagn",
    title: "Imagn",
    subtitle: "Sports imagery licensing",
  },
];

// Curated OSS publishing skills
const OSS_PUBLISHING_SKILLS = [
  {
    id: "wordpress-publisher",
    title: "wordpress-publisher",
    subtitle: "Publish posts to WordPress",
  },
  {
    id: "social-scheduler",
    title: "social-scheduler",
    subtitle: "Queue social posts",
  },
  {
    id: "feed-dispatcher",
    title: "feed-dispatcher",
    subtitle: "Fan-out to multiple feeds",
  },
];

// Curated Machina publishing connectors
const MACHINA_PUBLISHING_CONNECTORS = [
  { id: "wordpress", title: "WordPress", subtitle: "CMS connector" },
  { id: "slack", title: "Slack", subtitle: "Channel notifications" },
  { id: "twitter", title: "Twitter / X", subtitle: "Post to X" },
  { id: "instagram", title: "Instagram", subtitle: "Publish stories & reels" },
];

const STATIC_COMMANDS = [
  { cmd: "machina workflow list", desc: "List all workflows" },
  {
    cmd: "machina workflow run <name> --sync",
    desc: "Run a workflow synchronously",
  },
  { cmd: "machina agent list", desc: "List all agents" },
  {
    cmd: "machina agent run <name> --sync",
    desc: "Run an agent synchronously",
  },
  { cmd: "machina template push <dir>", desc: "Push a local template" },
  { cmd: "machina template list", desc: "List installed templates" },
  { cmd: "machina credentials list", desc: "List credentials" },
];

function matchQuery(q: string, fields: (string | undefined | null)[]): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return fields.some((f) => f?.toLowerCase().includes(needle));
}

type ApiRepo = {
  fullName: string;
  name: string;
  owner: string;
  language?: string | null;
  isPrivate?: boolean;
};

type ApiJob = {
  id: string;
  task: string;
  status: string;
};

type ApiNamed = { name: string; title?: string };

export function useMentions(query: string) {
  const [repos, setRepos] = useState<MentionItem[]>([]);
  const [jobs, setJobs] = useState<MentionItem[]>([]);
  const [remoteTemplates, setRemoteTemplates] = useState<MentionItem[]>([]);
  const [remoteWorkflows, setRemoteWorkflows] = useState<MentionItem[]>([]);
  const [remoteAgents, setRemoteAgents] = useState<MentionItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);

    Promise.all([
      fetch(`/factory/api/github/repos?org=machina-sports&q=${query}`)
        .then((r) => r.json())
        .catch(() => ({ repos: [] })),
      fetch(`/factory/api/jobs/recent`)
        .then((r) => r.json())
        .catch(() => ({ jobs: [] })),
      fetch(`/factory/api/templates`, { method: "POST" })
        .then((r) => r.json())
        .catch(() => ({ data: [] })),
      fetch(`/factory/api/workflows`, { method: "POST" })
        .then((r) => r.json())
        .catch(() => ({ workflows: [] })),
      fetch(`/factory/api/agents`, { method: "POST" })
        .then((r) => r.json())
        .catch(() => ({ agents: [] })),
    ]).then(
      ([reposData, jobsData, templatesData, workflowsData, agentsData]) => {
        if (!mounted) return;

        setRepos(
          (reposData.repos || [])
            .filter((r: ApiRepo) => matchQuery(query, [r.fullName, r.language]))
            .map((r: ApiRepo) => ({
              id: r.fullName,
              type: "repo" as const,
              category: "code" as const,
              title: r.fullName,
              subtitle: r.language || (r.isPrivate ? "Private" : "Public"),
              icon: <GitBranch className="h-4 w-4" />,
              data: r,
            })),
        );

        setJobs(
          (jobsData.jobs || [])
            .filter((j: ApiJob) => matchQuery(query, [j.task, j.id]))
            .map((j: ApiJob) => ({
              id: j.id,
              type: "job" as const,
              category: "code" as const,
              title: j.task.slice(0, 60) + (j.task.length > 60 ? "..." : ""),
              subtitle: j.status,
              icon:
                j.status === "completed" ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : j.status === "failed" ? (
                  <XCircle className="h-4 w-4 text-red-500" />
                ) : (
                  <Clock className="h-4 w-4 text-amber-500" />
                ),
              data: j,
            })),
        );

        const templates: ApiNamed[] =
          templatesData?.data || templatesData?.templates || [];
        setRemoteTemplates(
          templates
            .filter((t) => matchQuery(query, [t.name, t.title]))
            .map((t) => ({
              id: `tpl:${t.name}`,
              type: "template" as const,
              category: "content-ai" as const,
              bucket: "machina" as const,
              title: t.title || t.name,
              subtitle: t.name,
              icon: <BookOpen className="h-4 w-4" />,
              data: t,
            })),
        );

        const workflows: ApiNamed[] =
          workflowsData?.workflows || workflowsData?.data || [];
        setRemoteWorkflows(
          workflows
            .filter((w) => matchQuery(query, [w.name, w.title]))
            .map((w) => ({
              id: `wf:${w.name}`,
              type: "workflow" as const,
              category: "content-ai" as const,
              bucket: "machina" as const,
              title: w.name,
              subtitle: w.title,
              icon: <ListTodo className="h-4 w-4" />,
              data: w,
            })),
        );

        const agents: ApiNamed[] = agentsData?.agents || agentsData?.data || [];
        setRemoteAgents(
          agents
            .filter((a) => matchQuery(query, [a.name, a.title]))
            .map((a) => ({
              id: `ag:${a.name}`,
              type: "agent" as const,
              category: "content-ai" as const,
              bucket: "machina" as const,
              title: a.name,
              subtitle: a.title,
              icon: <Bot className="h-4 w-4" />,
              data: a,
            })),
        );

        setLoading(false);
      },
    );

    return () => {
      mounted = false;
    };
  }, [query]);

  // Static skills filtered by query
  const ossSports: MentionItem[] = OSS_SPORTS_SKILLS.filter((s) =>
    matchQuery(query, [s.title, s.subtitle]),
  ).map((s) => ({
    id: `skill:${s.id}`,
    type: "skill" as const,
    category: "sports-data" as const,
    bucket: "oss" as const,
    title: s.title,
    subtitle: s.subtitle,
    icon: <Radio className="h-4 w-4" />,
    data: s,
  }));

  const machinaSports: MentionItem[] = MACHINA_SPORTS_CONNECTORS.filter((c) =>
    matchQuery(query, [c.title, c.subtitle]),
  ).map((c) => ({
    id: `conn:${c.id}`,
    type: "connector" as const,
    category: "sports-data" as const,
    bucket: "machina" as const,
    title: c.title,
    subtitle: c.subtitle,
    icon: <Database className="h-4 w-4" />,
    data: c,
  }));

  const ossContent: MentionItem[] = OSS_CONTENT_SKILLS.filter((s) =>
    matchQuery(query, [s.title, s.subtitle]),
  ).map((s) => ({
    id: `skill:${s.id}`,
    type: "skill" as const,
    category: "content-ai" as const,
    bucket: "oss" as const,
    title: s.title,
    subtitle: s.subtitle,
    icon: <Sparkles className="h-4 w-4" />,
    data: s,
  }));

  const machinaContent: MentionItem[] = [
    ...MACHINA_CONTENT_CONNECTORS.filter((c) =>
      matchQuery(query, [c.title, c.subtitle]),
    ).map(
      (c) =>
        ({
          id: `conn:${c.id}`,
          type: "connector" as const,
          category: "content-ai" as const,
          bucket: "machina" as const,
          title: c.title,
          subtitle: c.subtitle,
          icon: <Database className="h-4 w-4" />,
          data: c,
        }) satisfies MentionItem,
    ),
    ...remoteTemplates,
    ...remoteWorkflows,
    ...remoteAgents,
  ];

  const ossPublishing: MentionItem[] = OSS_PUBLISHING_SKILLS.filter((s) =>
    matchQuery(query, [s.title, s.subtitle]),
  ).map((s) => ({
    id: `skill:${s.id}`,
    type: "skill" as const,
    category: "publishing" as const,
    bucket: "oss" as const,
    title: s.title,
    subtitle: s.subtitle,
    icon: <Send className="h-4 w-4" />,
    data: s,
  }));

  const machinaPublishing: MentionItem[] = MACHINA_PUBLISHING_CONNECTORS.filter(
    (c) => matchQuery(query, [c.title, c.subtitle]),
  ).map((c) => ({
    id: `conn:${c.id}`,
    type: "connector" as const,
    category: "publishing" as const,
    bucket: "machina" as const,
    title: c.title,
    subtitle: c.subtitle,
    icon: <FileText className="h-4 w-4" />,
    data: c,
  }));

  const commands: MentionItem[] = STATIC_COMMANDS.filter((c) =>
    matchQuery(query, [c.cmd, c.desc]),
  ).map((c) => ({
    id: `cmd:${c.cmd}`,
    type: "cmd" as const,
    category: "commands" as const,
    title: c.cmd,
    subtitle: c.desc,
    icon: <Terminal className="h-4 w-4" />,
    data: c,
  }));

  const byCategory: Record<
    CategoryKey,
    { oss: MentionItem[]; machina: MentionItem[]; flat: MentionItem[] }
  > = {
    code: { oss: [], machina: [], flat: [...repos, ...jobs] },
    "sports-data": {
      oss: ossSports,
      machina: machinaSports,
      flat: [...ossSports, ...machinaSports],
    },
    "content-ai": {
      oss: ossContent,
      machina: machinaContent,
      flat: [...ossContent, ...machinaContent],
    },
    publishing: {
      oss: ossPublishing,
      machina: machinaPublishing,
      flat: [...ossPublishing, ...machinaPublishing],
    },
    commands: { oss: [], machina: [], flat: commands },
  };

  return { byCategory, loading };
}
