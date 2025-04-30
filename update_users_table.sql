-- Add necessary columns to users table if they don't exist
DO $$
BEGIN
    -- Add last_workflow_run column
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'users'
        AND column_name = 'last_workflow_run'
    ) THEN
        ALTER TABLE users
        ADD COLUMN last_workflow_run TIMESTAMP WITH TIME ZONE;
    END IF;

    -- Add last_analysis_results column to store analysis results
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'users'
        AND column_name = 'last_analysis_results'
    ) THEN
        ALTER TABLE users
        ADD COLUMN last_analysis_results JSONB;
    END IF;

    -- Add analysis_ready_for_email flag
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'users'
        AND column_name = 'analysis_ready_for_email'
    ) THEN
        ALTER TABLE users
        ADD COLUMN analysis_ready_for_email BOOLEAN DEFAULT FALSE;
    END IF;
END $$;
