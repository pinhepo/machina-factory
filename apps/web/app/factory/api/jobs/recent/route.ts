import { NextResponse } from "next/server";

export async function GET() {
  const apiUrl = process.env.FACTORY_API_URL;
  const apiKey = process.env.FACTORY_API_KEY;

  if (!apiUrl || !apiKey) {
    return NextResponse.json({ jobs: [] });
  }

  try {
    const res = await fetch(`${apiUrl}/v1/jobs?limit=20`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      return NextResponse.json({ jobs: [] });
    }
    const data = await res.json();
    return NextResponse.json({ jobs: data.jobs || [] });
  } catch {
    return NextResponse.json({ jobs: [] });
  }
}
