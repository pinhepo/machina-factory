"use server";

import { redirect } from "next/navigation";
import { login } from "../auth";

export async function handleLogin(formData: FormData) {
  const password = formData.get("password") as string;
  const success = await login(password);
  if (success) {
    redirect("/factory");
  } else {
    redirect("/factory/login?error=invalid");
  }
}
