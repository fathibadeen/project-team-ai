export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      agents: {
        Row: {
          color: string
          created_at: string
          id: string
          instructions: string
          is_leader: boolean
          model: string
          name: string
          provider: string
          provider_key_id: string | null
          role: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          instructions?: string
          is_leader?: boolean
          model?: string
          name: string
          provider?: string
          provider_key_id?: string | null
          role?: string
          user_id?: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          instructions?: string
          is_leader?: boolean
          model?: string
          name?: string
          provider?: string
          provider_key_id?: string | null
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      artifacts: {
        Row: {
          agent_name: string | null
          content: string
          created_at: string
          filename: string
          id: string
          project_id: string
          task_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          agent_name?: string | null
          content?: string
          created_at?: string
          filename?: string
          id?: string
          project_id: string
          task_id?: string | null
          title: string
          user_id?: string
        }
        Update: {
          agent_name?: string | null
          content?: string
          created_at?: string
          filename?: string
          id?: string
          project_id?: string
          task_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "artifacts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifacts_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      discussion_runs: {
        Row: {
          created_at: string
          error: string | null
          id: string
          max_rounds: number
          participants: string[]
          pending: string[]
          phase: string
          project_id: string
          prompt: string
          round: number
          status: string
          steps_done: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          max_rounds?: number
          participants?: string[]
          pending?: string[]
          phase?: string
          project_id: string
          prompt: string
          round?: number
          status?: string
          steps_done?: number
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          max_rounds?: number
          participants?: string[]
          pending?: string[]
          phase?: string
          project_id?: string
          prompt?: string
          round?: number
          status?: string
          steps_done?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "discussion_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          agent_id: string | null
          agent_name: string | null
          content: string
          created_at: string
          id: string
          key_points: string[]
          kind: string
          project_id: string
          round: number | null
          run_id: string | null
          stance: string | null
          targets: string[]
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          agent_name?: string | null
          content?: string
          created_at?: string
          id?: string
          key_points?: string[]
          kind?: string
          project_id: string
          round?: number | null
          run_id?: string | null
          stance?: string | null
          targets?: string[]
          user_id?: string
        }
        Update: {
          agent_id?: string | null
          agent_name?: string | null
          content?: string
          created_at?: string
          id?: string
          key_points?: string[]
          kind?: string
          project_id?: string
          round?: number | null
          run_id?: string | null
          stance?: string | null
          targets?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "discussion_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      project_files: {
        Row: {
          content: string
          created_at: string
          id: string
          name: string
          project_id: string
          size: number
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          name: string
          project_id: string
          size?: number
          user_id?: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          name?: string
          project_id?: string
          size?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          agent_ids: string[]
          created_at: string
          description: string
          id: string
          title: string
          user_id: string
        }
        Insert: {
          agent_ids?: string[]
          created_at?: string
          description?: string
          id?: string
          title: string
          user_id?: string
        }
        Update: {
          agent_ids?: string[]
          created_at?: string
          description?: string
          id?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      provider_keys: {
        Row: {
          api_key: string
          base_url: string
          created_at: string
          id: string
          kind: string
          label: string
          user_id: string
        }
        Insert: {
          api_key: string
          base_url?: string
          created_at?: string
          id?: string
          kind?: string
          label: string
          user_id?: string
        }
        Update: {
          api_key?: string
          base_url?: string
          created_at?: string
          id?: string
          kind?: string
          label?: string
          user_id?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          agent_id: string | null
          created_at: string
          details: string
          id: string
          output_type: string
          project_id: string
          status: string
          title: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          details?: string
          id?: string
          output_type?: string
          project_id: string
          status?: string
          title: string
          user_id?: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          details?: string
          id?: string
          output_type?: string
          project_id?: string
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
