import { NextResponse } from "next/server";

export async function POST() {
  const apiUrl = process.env.MACHINA_CLIENT_API_URL;
  const apiToken = process.env.MACHINA_API_TOKEN;

  if (!apiUrl || !apiToken) {
    return NextResponse.json({
      error: "Configure MACHINA_API_TOKEN to see workflows",
      workflows: [],
    });
  }

  try {
    const res = await fetch(`${apiUrl}/workflow/search`, {
      method: "POST",
      headers: {
        "X-Api-Token": apiToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filters: {}, page: 1, page_size: 50 }),
    });
    if (!res.ok) {
      return NextResponse.json({ workflows: [] });
    }
    const data = await res.json();
    return NextResponse.json({ workflows: data.data || [] });
  } catch {
    return NextResponse.json({ workflows: [] });
  }
}
