import { NextResponse } from "next/server";
import { getInstallationToken } from "@/lib/github-app";

export const dynamic = "force-dynamic";

interface GitHubRepo {
  full_name: string;
  name: string;
  owner: { login: string };
  default_branch: string;
  description: string | null;
  language: string | null;
  updated_at: string;
  private: boolean;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const org = url.searchParams.get("org") ?? "machina-sports";
  const query = url.searchParams.get("q") ?? "";

  try {
    const token = await getInstallationToken(org);

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "machina-factory-dashboard",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(
      `https://api.github.com/orgs/${encodeURIComponent(org)}/repos?per_page=100&sort=updated&direction=desc&type=all`,
      {
        headers,
        next: { revalidate: 60 }, // Cache for 60s
      },
    );

    if (!res.ok) {
      return NextResponse.json({ repos: [] });
    }

    const data = (await res.json()) as GitHubRepo[];

    let repos = data.map((r) => ({
      fullName: r.full_name,
      name: r.name,
      owner: r.owner.login,
      defaultBranch: r.default_branch,
      description: r.description,
      language: r.language,
      updatedAt: r.updated_at,
      isPrivate: r.private,
    }));

    // Filter by search query
    if (query) {
      const q = query.toLowerCase();
      repos = repos.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.fullName.toLowerCase().includes(q) ||
          (r.description && r.description.toLowerCase().includes(q)),
      );
    }

    return NextResponse.json({ repos });
  } catch {
    return NextResponse.json({ repos: [] });
  }
}
