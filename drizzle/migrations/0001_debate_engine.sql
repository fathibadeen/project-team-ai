CREATE TABLE public.discussion_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  prompt text NOT NULL,
  max_rounds smallint NOT NULL DEFAULT 2,
  round smallint NOT NULL DEFAULT 1,
  participants uuid[] NOT NULL DEFAULT '{}',
  pending uuid[] NOT NULL DEFAULT '{}',
  phase text NOT NULL DEFAULT 'debate',
  status text NOT NULL DEFAULT 'running',
  steps_done smallint NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discussion_runs TO authenticated;
GRANT ALL ON public.discussion_runs TO service_role;
ALTER TABLE public.discussion_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own runs" ON public.discussion_runs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX discussion_runs_project_idx ON public.discussion_runs (project_id, created_at DESC);

ALTER TABLE public.messages
  ADD COLUMN run_id uuid REFERENCES public.discussion_runs(id) ON DELETE SET NULL,
  ADD COLUMN round smallint,
  ADD COLUMN kind text NOT NULL DEFAULT 'agent',
  ADD COLUMN stance text,
  ADD COLUMN targets uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN key_points text[] NOT NULL DEFAULT '{}';

UPDATE public.messages SET kind = 'user' WHERE agent_name IS NULL;

CREATE INDEX messages_project_created_idx ON public.messages (project_id, created_at DESC);
