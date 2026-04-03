import { supabase } from "../../config/supabase";

type UserRole = "mentor" | "student";

type RegisterInput = {
  email: string;
  password: string;
  full_name: string;
  role: UserRole;
};

type LoginInput = {
  email: string;
  password: string;
};

type UserProfile = {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  avatar_url: string | null;
  created_at: string;
};

type StatusedError = Error & { status?: number };

const withStatus = (status: number, message: string): StatusedError => {
  const err = new Error(message) as StatusedError;
  err.status = status;
  return err;
};

const mapSupabaseNetworkFailure = (e: unknown): StatusedError | null => {
  if (!(e instanceof Error)) return null;
  const cause = (e as Error & { cause?: unknown }).cause;
  if (cause instanceof Error && "code" in cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ECONNREFUSED" || code === "ETIMEDOUT") {
      return withStatus(
        503,
        "Cannot reach Supabase. Verify SUPABASE_URL in backend/.env matches your project URL from the Supabase Dashboard (Settings → API). The hostname must match the ref embedded in your anon/service keys."
      );
    }
  }
  if (e.message.includes("fetch failed")) {
    return withStatus(503, "Cannot reach Supabase. Check SUPABASE_URL, DNS, and your network connection.");
  }
  return null;
};

export const authService = {
  register: async (input: RegisterInput): Promise<UserProfile> => {
    let created: Awaited<ReturnType<typeof supabase.auth.admin.createUser>>["data"];
    let createError: Awaited<ReturnType<typeof supabase.auth.admin.createUser>>["error"];

    try {
      const result = await supabase.auth.admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: true,
        user_metadata: {
          full_name: input.full_name,
          role: input.role
        }
      });
      created = result.data;
      createError = result.error;
    } catch (e) {
      const mapped = mapSupabaseNetworkFailure(e);
      if (mapped) throw mapped;
      throw e;
    }

    if (createError || !created?.user) {
      const msg = createError?.message ?? "Failed to create user";
      const lower = msg.toLowerCase();
      if (lower.includes("already") || lower.includes("registered")) {
        throw withStatus(409, "An account with this email already exists");
      }
      throw withStatus(400, msg);
    }

    // Upsert: many Supabase projects use a trigger that inserts into `public.users`
    // when an auth user is created; a plain insert would then fail with a duplicate key.
    const { data: userRow, error: upsertError } = await supabase
      .from("users")
      .upsert(
        {
          id: created.user.id,
          email: input.email,
          full_name: input.full_name,
          role: input.role,
          avatar_url: null
        },
        { onConflict: "id" }
      )
      .select("id, email, full_name, role, avatar_url, created_at")
      .single();

    if (upsertError || !userRow) {
      throw withStatus(400, upsertError?.message ?? "Failed to create user profile");
    }

    return userRow as UserProfile;
  },

  login: async (
    input: LoginInput
  ): Promise<{ user: { id: string; email: string }; access_token: string }> => {
    let data: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>["data"];
    let error: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>["error"];

    try {
      const result = await supabase.auth.signInWithPassword({
        email: input.email,
        password: input.password
      });
      data = result.data;
      error = result.error;
    } catch (e) {
      const mapped = mapSupabaseNetworkFailure(e);
      if (mapped) throw mapped;
      throw e;
    }

    if (error || !data?.user || !data?.session?.access_token) {
      throw withStatus(401, error?.message ?? "Invalid credentials");
    }

    return {
      user: { id: data.user.id, email: data.user.email ?? input.email },
      access_token: data.session.access_token
    };
  },

  me: async (userId: string): Promise<UserProfile> => {
    const { data: profile, error } = await supabase
      .from("users")
      .select("id, email, full_name, role, avatar_url, created_at")
      .eq("id", userId)
      .single();

    if (error || !profile) {
      throw withStatus(404, error?.message ?? "User profile not found");
    }

    return profile as UserProfile;
  }
};

