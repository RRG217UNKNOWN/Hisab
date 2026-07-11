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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string
          changes: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          org_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          changes?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          org_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          changes?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          org_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_counters: {
        Row: {
          bill_type: string
          next_number: number
          scope_id: string
        }
        Insert: {
          bill_type: string
          next_number?: number
          scope_id: string
        }
        Update: {
          bill_type?: string
          next_number?: number
          scope_id?: string
        }
        Relationships: []
      }
      bill_items: {
        Row: {
          bill_id: string
          cgst_amount: number
          created_at: string
          gst_rate: number
          hsn_sac_code: string | null
          id: string
          igst_amount: number
          item_id: string | null
          item_name: string
          line_discount: number
          line_total: number
          quantity: number
          sgst_amount: number
          taxable_value: number
          unit_cost: number
          unit_price: number
        }
        Insert: {
          bill_id: string
          cgst_amount?: number
          created_at?: string
          gst_rate?: number
          hsn_sac_code?: string | null
          id?: string
          igst_amount?: number
          item_id?: string | null
          item_name: string
          line_discount?: number
          line_total?: number
          quantity: number
          sgst_amount?: number
          taxable_value?: number
          unit_cost?: number
          unit_price?: number
        }
        Update: {
          bill_id?: string
          cgst_amount?: number
          created_at?: string
          gst_rate?: number
          hsn_sac_code?: string | null
          id?: string
          igst_amount?: number
          item_id?: string | null
          item_name?: string
          line_discount?: number
          line_total?: number
          quantity?: number
          sgst_amount?: number
          taxable_value?: number
          unit_cost?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "bill_items_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      bills: {
        Row: {
          bill_type: string
          created_at: string
          customer_address: string | null
          customer_gstin: string | null
          customer_name: string | null
          discount_amount: number
          discount_type: string | null
          discount_value: number
          fulfills_request_id: string | null
          id: string
          invoice_date: string
          invoice_number: string | null
          org_id: string | null
          party_id: string | null
          payment_method: string | null
          place_of_supply: string | null
          reverse_charge: boolean
          status: string
          subtotal: number
          supplier_address: string | null
          supplier_gstin: string | null
          supplier_invoice_number: string | null
          supplier_name: string | null
          total: number
          user_id: string
          warehouse_id: string
        }
        Insert: {
          bill_type?: string
          created_at?: string
          customer_address?: string | null
          customer_gstin?: string | null
          customer_name?: string | null
          discount_amount?: number
          discount_type?: string | null
          discount_value?: number
          fulfills_request_id?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: string | null
          org_id?: string | null
          party_id?: string | null
          payment_method?: string | null
          place_of_supply?: string | null
          reverse_charge?: boolean
          status?: string
          subtotal?: number
          supplier_address?: string | null
          supplier_gstin?: string | null
          supplier_invoice_number?: string | null
          supplier_name?: string | null
          total?: number
          user_id: string
          warehouse_id: string
        }
        Update: {
          bill_type?: string
          created_at?: string
          customer_address?: string | null
          customer_gstin?: string | null
          customer_name?: string | null
          discount_amount?: number
          discount_type?: string | null
          discount_value?: number
          fulfills_request_id?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: string | null
          org_id?: string | null
          party_id?: string | null
          payment_method?: string | null
          place_of_supply?: string | null
          reverse_charge?: boolean
          status?: string
          subtotal?: number
          supplier_address?: string | null
          supplier_gstin?: string | null
          supplier_invoice_number?: string | null
          supplier_name?: string | null
          total?: number
          user_id?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bills_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          cadence: string
          created_at: string
          id: string
          label: string
          org_id: string | null
          party_id: string | null
          payment_method: string | null
          user_id: string
          warehouse_id: string | null
        }
        Insert: {
          amount: number
          cadence?: string
          created_at?: string
          id?: string
          label: string
          org_id?: string | null
          party_id?: string | null
          payment_method?: string | null
          user_id: string
          warehouse_id?: string | null
        }
        Update: {
          amount?: number
          cadence?: string
          created_at?: string
          id?: string
          label?: string
          org_id?: string | null
          party_id?: string | null
          payment_method?: string | null
          user_id?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          category: string
          cost_price: number
          created_at: string
          expiry: string | null
          id: string
          min_stock: number
          name: string
          org_id: string | null
          price: number
          stock: number
          updated_at: string
          user_id: string
          warehouse_id: string
        }
        Insert: {
          category?: string
          cost_price?: number
          created_at?: string
          expiry?: string | null
          id?: string
          min_stock?: number
          name: string
          org_id?: string | null
          price?: number
          stock?: number
          updated_at?: string
          user_id: string
          warehouse_id: string
        }
        Update: {
          category?: string
          cost_price?: number
          created_at?: string
          expiry?: string | null
          id?: string
          min_stock?: number
          name?: string
          org_id?: string | null
          price?: number
          stock?: number
          updated_at?: string
          user_id?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          created_at: string
          email: string
          id: string
          invited_by: string
          org_id: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
          warehouse_ids: string[]
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          invited_by: string
          org_id: string
          role: Database["public"]["Enums"]["app_role"]
          status?: string
          warehouse_ids?: string[]
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          invited_by?: string
          org_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          warehouse_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "invites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      member_shops: {
        Row: {
          created_at: string
          id: string
          profile_id: string
          warehouse_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          profile_id: string
          warehouse_id: string
        }
        Update: {
          created_at?: string
          id?: string
          profile_id?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_shops_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_shops_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          business_address: string | null
          created_at: string
          created_by: string | null
          gstin: string | null
          id: string
          name: string
          org_code: string
          state: string | null
          updated_at: string
        }
        Insert: {
          business_address?: string | null
          created_at?: string
          created_by?: string | null
          gstin?: string | null
          id?: string
          name: string
          org_code: string
          state?: string | null
          updated_at?: string
        }
        Update: {
          business_address?: string | null
          created_at?: string
          created_by?: string | null
          gstin?: string | null
          id?: string
          name?: string
          org_code?: string
          state?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      parties: {
        Row: {
          address: string | null
          bank_account_no: string | null
          bank_ifsc: string | null
          bank_name: string | null
          country: string | null
          created_at: string
          email: string | null
          gst_no: string | null
          id: string
          name: string
          notes: string | null
          org_id: string | null
          pan_no: string | null
          phone: string | null
          registration_type: string | null
          state: string | null
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          bank_account_no?: string | null
          bank_ifsc?: string | null
          bank_name?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          gst_no?: string | null
          id?: string
          name: string
          notes?: string | null
          org_id?: string | null
          pan_no?: string | null
          phone?: string | null
          registration_type?: string | null
          state?: string | null
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          bank_account_no?: string | null
          bank_ifsc?: string | null
          bank_name?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          gst_no?: string | null
          id?: string
          name?: string
          notes?: string | null
          org_id?: string | null
          pan_no?: string | null
          phone?: string | null
          registration_type?: string | null
          state?: string | null
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parties_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_orgs: {
        Row: {
          added_by: string | null
          created_at: string
          id: string
          org_id: string
          partner_org_id: string
          status: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          id?: string
          org_id: string
          partner_org_id: string
          status?: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          id?: string
          org_id?: string
          partner_org_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_orgs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_orgs_partner_org_id_fkey"
            columns: ["partner_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      party_payments: {
        Row: {
          amount: number
          created_at: string
          direction: string
          id: string
          note: string | null
          org_id: string | null
          party_id: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          direction: string
          id?: string
          note?: string | null
          org_id?: string | null
          party_id: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          direction?: string
          id?: string
          note?: string | null
          org_id?: string | null
          party_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "party_payments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "party_payments_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          business_address: string | null
          created_at: string
          full_name: string | null
          gstin: string | null
          id: string
          language: string
          org_id: string | null
          phone: string | null
          role: Database["public"]["Enums"]["app_role"]
          state: string | null
          updated_at: string
        }
        Insert: {
          business_address?: string | null
          created_at?: string
          full_name?: string | null
          gstin?: string | null
          id: string
          language?: string
          org_id?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          state?: string | null
          updated_at?: string
        }
        Update: {
          business_address?: string | null
          created_at?: string
          full_name?: string | null
          gstin?: string | null
          id?: string
          language?: string
          org_id?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          state?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      requests: {
        Row: {
          bill_id: string | null
          created_at: string
          created_by: string | null
          from_org_id: string
          fulfilling_warehouse_id: string | null
          id: string
          items: Json
          narration: string | null
          order_completed_at: string | null
          payment_received: number
          payment_status: string
          responded_by: string | null
          status: string
          to_org_id: string
        }
        Insert: {
          bill_id?: string | null
          created_at?: string
          created_by?: string | null
          from_org_id: string
          fulfilling_warehouse_id?: string | null
          id?: string
          items?: Json
          narration?: string | null
          order_completed_at?: string | null
          payment_received?: number
          payment_status?: string
          responded_by?: string | null
          status?: string
          to_org_id: string
        }
        Update: {
          bill_id?: string | null
          created_at?: string
          created_by?: string | null
          from_org_id?: string
          fulfilling_warehouse_id?: string | null
          id?: string
          items?: Json
          narration?: string | null
          order_completed_at?: string | null
          payment_received?: number
          payment_status?: string
          responded_by?: string | null
          status?: string
          to_org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "requests_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_from_org_id_fkey"
            columns: ["from_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_fulfilling_warehouse_id_fkey"
            columns: ["fulfilling_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_to_org_id_fkey"
            columns: ["to_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          created_at: string
          id: string
          item_id: string | null
          item_name: string
          org_id: string | null
          quantity: number
          total: number
          unit_cost: number
          unit_price: number
          user_id: string
          warehouse_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          item_id?: string | null
          item_name: string
          org_id?: string | null
          quantity: number
          total: number
          unit_cost?: number
          unit_price: number
          user_id: string
          warehouse_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string | null
          item_name?: string
          org_id?: string | null
          quantity?: number
          total?: number
          unit_cost?: number
          unit_price?: number
          user_id?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_adjustments: {
        Row: {
          created_at: string
          id: string
          item_id: string | null
          new_stock: number
          org_id: string | null
          reason: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_id?: string | null
          new_stock: number
          org_id?: string | null
          reason: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string | null
          new_stock?: number
          org_id?: string | null
          reason?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustments_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_dues: {
        Row: {
          amount: number
          category: string
          created_at: string
          id: string
          note: string | null
          org_id: string | null
          status: string
          user_id: string
          vendor_name: string
          warehouse_id: string | null
        }
        Insert: {
          amount?: number
          category?: string
          created_at?: string
          id?: string
          note?: string | null
          org_id?: string | null
          status?: string
          user_id: string
          vendor_name: string
          warehouse_id?: string | null
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          id?: string
          note?: string | null
          org_id?: string | null
          status?: string
          user_id?: string
          vendor_name?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_dues_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_dues_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouses: {
        Row: {
          address: string | null
          created_at: string
          id: string
          name: string
          org_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          name: string
          org_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          name?: string
          org_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "warehouses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      party_ledger: {
        Row: {
          amount: number | null
          date: string | null
          description: string | null
          direction: string | null
          org_id: string | null
          party_id: string | null
          source_id: string | null
          source_table: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      can_read_row: {
        Args: { row_org_id: string; row_user_id: string }
        Returns: boolean
      }
      can_write_shop: { Args: { row_warehouse_id: string }; Returns: boolean }
      create_organization: {
        Args: { _name: string }
        Returns: {
          id: string
          org_code: string
        }[]
      }
      current_org_id: { Args: never; Returns: string }
      current_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      generate_org_code: { Args: never; Returns: string }
      join_organization: { Args: { _code: string }; Returns: string }
      next_invoice_number: { Args: { _bill_type: string }; Returns: string }
      verify_org_code: {
        Args: { _code: string }
        Returns: {
          id: string
          name: string
        }[]
      }
    }
    Enums: {
      app_role: "owner" | "manager" | "staff" | "accountant"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["owner", "manager", "staff", "accountant"],
    },
  },
} as const
