
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "appliances": {
                  Row: {
                    "category": string,"created_at": string,"home_id": string,"id": string,"identification_confidence": number | null,"image_url": string | null,"manufacturer": string | null,"model": string | null,"serial_number": string | null
                  }
                  Insert: {
                    "category"?: string,"created_at"?: string,"home_id": string,"id"?: string,"identification_confidence"?: number | null,"image_url"?: string | null,"manufacturer"?: string | null,"model"?: string | null,"serial_number"?: string | null
                  }
                  Update: {
                    "category"?: string,"created_at"?: string,"home_id"?: string,"id"?: string,"identification_confidence"?: number | null,"image_url"?: string | null,"manufacturer"?: string | null,"model"?: string | null,"serial_number"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "appliances_home_id_fkey"
      columns: ["home_id"]
isOneToOne: false
      referencedRelation: "homes"
      referencedColumns: ["id"]
    }
                  ]
                },"funnel_events": {
                  Row: {
                    "appliance_id": string | null,"created_at": string,"id": string,"name": string,"props": NonNullable<Json>,"user_id": string
                  }
                  Insert: {
                    "appliance_id"?: string | null,"created_at"?: string,"id"?: string,"name": string,"props"?: NonNullable<Json>,"user_id": string
                  }
                  Update: {
                    "appliance_id"?: string | null,"created_at"?: string,"id"?: string,"name"?: string,"props"?: NonNullable<Json>,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "funnel_events_appliance_id_fkey"
      columns: ["appliance_id"]
isOneToOne: false
      referencedRelation: "appliances"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "funnel_events_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"homes": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "homes_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"maintenance_completions": {
                  Row: {
                    "completed_at": string,"created_at": string,"id": string,"maintenance_task_id": string,"notes": string | null
                  }
                  Insert: {
                    "completed_at": string,"created_at"?: string,"id"?: string,"maintenance_task_id": string,"notes"?: string | null
                  }
                  Update: {
                    "completed_at"?: string,"created_at"?: string,"id"?: string,"maintenance_task_id"?: string,"notes"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "maintenance_completions_maintenance_task_id_fkey"
      columns: ["maintenance_task_id"]
isOneToOne: false
      referencedRelation: "maintenance_tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"maintenance_recommendations": {
                  Row: {
                    "appliance_id": string,"confidence": number | null,"created_at": string,"description": string | null,"evidence_level": Database["public"]['Enums']["evidence_level"],"id": string,"interval_count": number | null,"interval_unit": Database["public"]['Enums']["interval_unit"] | null,"source_document_id": string | null,"source_location": string | null,"task_name": string,"trigger_condition": string | null
                  }
                  Insert: {
                    "appliance_id": string,"confidence"?: number | null,"created_at"?: string,"description"?: string | null,"evidence_level": Database["public"]['Enums']["evidence_level"],"id"?: string,"interval_count"?: number | null,"interval_unit"?: Database["public"]['Enums']["interval_unit"] | null,"source_document_id"?: string | null,"source_location"?: string | null,"task_name": string,"trigger_condition"?: string | null
                  }
                  Update: {
                    "appliance_id"?: string,"confidence"?: number | null,"created_at"?: string,"description"?: string | null,"evidence_level"?: Database["public"]['Enums']["evidence_level"],"id"?: string,"interval_count"?: number | null,"interval_unit"?: Database["public"]['Enums']["interval_unit"] | null,"source_document_id"?: string | null,"source_location"?: string | null,"task_name"?: string,"trigger_condition"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "maintenance_recommendations_appliance_id_fkey"
      columns: ["appliance_id"]
isOneToOne: false
      referencedRelation: "appliances"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "maintenance_recommendations_source_document_id_appliance_i_fkey"
      columns: ["source_document_id","appliance_id"]
isOneToOne: false
      referencedRelation: "source_documents"
      referencedColumns: ["id","appliance_id"]
    }
                  ]
                },"maintenance_tasks": {
                  Row: {
                    "appliance_id": string,"approved_at": string | null,"calendar_event_id": string | null,"created_at": string,"id": string,"recommendation_id": string,"scheduling_mode": Database["public"]['Enums']["scheduling_mode"],"start_date": string | null,"status": Database["public"]['Enums']["task_status"],"user_interval_count": number | null,"user_interval_unit": Database["public"]['Enums']["interval_unit"] | null
                  }
                  Insert: {
                    "appliance_id": string,"approved_at"?: string | null,"calendar_event_id"?: string | null,"created_at"?: string,"id"?: string,"recommendation_id": string,"scheduling_mode": Database["public"]['Enums']["scheduling_mode"],"start_date"?: string | null,"status"?: Database["public"]['Enums']["task_status"],"user_interval_count"?: number | null,"user_interval_unit"?: Database["public"]['Enums']["interval_unit"] | null
                  }
                  Update: {
                    "appliance_id"?: string,"approved_at"?: string | null,"calendar_event_id"?: string | null,"created_at"?: string,"id"?: string,"recommendation_id"?: string,"scheduling_mode"?: Database["public"]['Enums']["scheduling_mode"],"start_date"?: string | null,"status"?: Database["public"]['Enums']["task_status"],"user_interval_count"?: number | null,"user_interval_unit"?: Database["public"]['Enums']["interval_unit"] | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "maintenance_tasks_appliance_id_fkey"
      columns: ["appliance_id"]
isOneToOne: false
      referencedRelation: "appliances"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "maintenance_tasks_recommendation_id_appliance_id_fkey"
      columns: ["recommendation_id","appliance_id"]
isOneToOne: false
      referencedRelation: "maintenance_recommendations"
      referencedColumns: ["id","appliance_id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"id": string,"name": string | null
                  }
                  Insert: {
                    "created_at"?: string,"id": string,"name"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"source_documents": {
                  Row: {
                    "appliance_id": string,"id": string,"manufacturer": string | null,"model_scope": string | null,"reference": string | null,"retrieved_at": string | null,"source_type": string,"title": string
                  }
                  Insert: {
                    "appliance_id": string,"id"?: string,"manufacturer"?: string | null,"model_scope"?: string | null,"reference"?: string | null,"retrieved_at"?: string | null,"source_type": string,"title": string
                  }
                  Update: {
                    "appliance_id"?: string,"id"?: string,"manufacturer"?: string | null,"model_scope"?: string | null,"reference"?: string | null,"retrieved_at"?: string | null,"source_type"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "source_documents_appliance_id_fkey"
      columns: ["appliance_id"]
isOneToOne: false
      referencedRelation: "appliances"
      referencedColumns: ["id"]
    }
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
            "evidence_level": "manufacturer_verified"|"similar_model"|"general","interval_unit": "day"|"week"|"month"|"year","scheduling_mode": "fixed_calendar"|"completion_based"|"condition_based","task_status": "proposed"|"approved"|"skipped"|"paused"|"removed"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "evidence_level": ["manufacturer_verified", "similar_model", "general"],"interval_unit": ["day", "week", "month", "year"],"scheduling_mode": ["fixed_calendar", "completion_based", "condition_based"],"task_status": ["proposed", "approved", "skipped", "paused", "removed"]
          }
        }
} as const
