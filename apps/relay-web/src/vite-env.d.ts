/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_RELAY_LOCAL_INTEGRATION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
