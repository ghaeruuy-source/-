-- Daily cash movement (الحركة اليومية): opening balance + every cash in/out row in a date range.
-- (deleted vouchers and void rows are excluded)
see Supabase migration 'cash_movements_hide_deleted' — function public.cash_movements(p_from date, p_to date)
