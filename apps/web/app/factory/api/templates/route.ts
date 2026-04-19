import { NextResponse } from "next/server";

export async function POST() {
  const apiUrl = process.env.MACHINA_CLIENT_API_URL;
  const apiToken = process.env.MACHINA_API_TOKEN;

  if (!apiUrl || !apiToken) {
    return NextResponse.json({
      error: "Configure MACHINA_API_TOKEN to see templates",
      data: [],
    });
  }

  try {
    const res = await fetch(`${apiUrl}/templates/directories/git`, {
      method: "POST",
      headers: {
        "X-Api-Token": apiToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      return NextResponse.json({ data: [] });
    }
    const data = await res.json();
    return NextResponse.json({ data: data.data || data.templates || [] });
  } catch {
    return NextResponse.json({ data: [] });
  }
}
