"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export type AuthState = {
  error?: string;
  notice?: string;
  fieldErrors?: Record<string, string[]>;
};

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  // Only allow internal, non-protocol-relative paths (prevents open redirects).
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

const optionalText = (max = 120) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null));

const RegisterSchema = z
  .object({
    fullName: z.string().trim().min(2, "Enter your full name.").max(120),
    email: z.string().trim().toLowerCase().email("Enter a valid email address."),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters.")
      .max(72, "Password must be 72 characters or fewer."),
    confirmPassword: z.string().min(1, "Re-enter your password."),
    // Fraternal information (all optional at registration)
    alexisName: optionalText(),
    batchName: optionalText(),
    dateSurvived: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.")
      .optional()
      .or(z.literal(""))
      .transform((v) => (v && v.length > 0 ? v : null)),
    gtName: optionalText(),
    gtNumber: optionalText(60),
    mwwName: optionalText(),
    mwwNumber: optionalText(60),
    contactNumber: optionalText(40),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export async function signUp(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = RegisterSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    alexisName: formData.get("alexisName") ?? "",
    batchName: formData.get("batchName") ?? "",
    dateSurvived: formData.get("dateSurvived") ?? "",
    gtName: formData.get("gtName") ?? "",
    gtNumber: formData.get("gtNumber") ?? "",
    mwwName: formData.get("mwwName") ?? "",
    mwwNumber: formData.get("mwwNumber") ?? "",
    contactNumber: formData.get("contactNumber") ?? "",
  });

  if (!parsed.success) {
    return {
      error: "Please correct the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const tenantSlug = (() => {
    const v = formData.get("tenantSlug");
    return typeof v === "string" && v.length > 0 ? v : null;
  })();

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    // These land in raw_user_meta_data; the handle_new_user trigger copies them
    // into the member's profile row (works whether or not email is confirmed).
    options: {
      data: {
        full_name: parsed.data.fullName,
        tenant_slug: tenantSlug,
        alexis_name: parsed.data.alexisName,
        batch_name: parsed.data.batchName,
        date_survived: parsed.data.dateSurvived,
        gt_name: parsed.data.gtName,
        gt_number: parsed.data.gtNumber,
        mww_name: parsed.data.mwwName,
        mww_number: parsed.data.mwwNumber,
        contact_number: parsed.data.contactNumber,
      },
    },
  });

  if (error) {
    return { error: error.message };
  }

  // Email confirmation enabled → no session yet.
  if (!data.session) {
    return {
      notice:
        "Registration received. Check your email to confirm your account, then sign in.",
    };
  }

  redirect(tenantSlug ? `/t/${tenantSlug}/dashboard` : "/");
}

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export async function signIn(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      error: "Please correct the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    if (error.code === "email_not_confirmed") {
      return {
        error:
          "Your email hasn't been confirmed yet. Check your inbox for the confirmation link, or ask an administrator to confirm your account.",
      };
    }
    return { error: "Invalid email or password. Please try again." };
  }

  redirect(safeNext(formData.get("next")));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/** Logged-in user self-joins a tenant as a pending member. */
export async function requestToJoin(formData: FormData): Promise<void> {
  const slug = formData.get("tenantSlug");
  if (typeof slug !== "string" || slug.length === 0) {
    throw new Error("Missing tenant.");
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?tenant=${encodeURIComponent(slug)}`);

  const { error } = await supabase.rpc("join_tenant_by_slug", { p_slug: slug });
  if (error) throw new Error(error.message);

  redirect(`/t/${slug}/dashboard`);
}
