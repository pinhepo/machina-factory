"use server";

import { revalidatePath } from "next/cache";

export async function advanceQueueAction(queueId: string) {
  const apiUrl = process.env.FACTORY_API_URL;
  const apiKey = process.env.FACTORY_API_KEY;

  if (!apiUrl || !apiKey) {
    return { error: "API not configured" };
  }

  const res = await fetch(`${apiUrl}/v1/queues/${queueId}/advance`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    return { error: `Failed to advance queue: ${text}` };
  }

  revalidatePath(`/factory/queue/${queueId}`);
  return { success: true };
}

export async function skipQueueItemAction(queueId: string) {
  const apiUrl = process.env.FACTORY_API_URL;
  const apiKey = process.env.FACTORY_API_KEY;

  if (!apiUrl || !apiKey) {
    return { error: "API not configured" };
  }

  const res = await fetch(`${apiUrl}/v1/queues/${queueId}/skip`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    return { error: `Failed to skip item: ${text}` };
  }

  revalidatePath(`/factory/queue/${queueId}`);
  return { success: true };
}

export async function cancelQueueAction(queueId: string) {
  const apiUrl = process.env.FACTORY_API_URL;
  const apiKey = process.env.FACTORY_API_KEY;

  if (!apiUrl || !apiKey) {
    return { error: "API not configured" };
  }

  const res = await fetch(`${apiUrl}/v1/queues/${queueId}/cancel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    return { error: `Failed to cancel queue: ${text}` };
  }

  revalidatePath(`/factory/queue/${queueId}`);
  return { success: true };
}
