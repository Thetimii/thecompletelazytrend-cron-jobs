# The Complete Lazy Trend - Scheduled Workflow Cron Job

This folder contains a cron job script that runs the complete workflow (generating queries, analyzing videos, etc.) for users at their specified times.

## How It Works

1. The script runs hourly and performs two main tasks:

   - For users scheduled to receive emails in the NEXT hour, it runs the complete workflow and stores the results
   - For users scheduled to receive emails in the CURRENT hour, it sends emails with the analysis results

2. This two-step process ensures:
   - Analysis is performed one hour before the scheduled email time
   - Results are ready when it's time to send the email
   - Users receive fresh analysis results at their preferred time

## Environment Variables

Create a `.env` file in this directory with the following variables:

```
SUPABASE_URL=https://your-supabase-url.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
API_BASE_URL=https://your-backend-api-url.com/api
BREVO_API_KEY=your-brevo-api-key
EMAIL_SENDER=noreply@lazy-trends.com
```

## Local Development

To run the script locally:

```bash
cd cron-jobs
npm install
npm start
```

## Deployment on Render.com

1. Create a new **Cron Job** service on Render.com
2. Set the build command to `cd cron-jobs && npm install`
3. Set the start command to `cd cron-jobs && node scheduled-workflow.js`
4. Set the schedule to `0 * * * *` (runs at the start of every hour)
5. Add the environment variables listed above

## User Configuration

Users can configure their scheduled workflow preferences through:

1. `email_notifications` - Boolean flag to opt in/out of scheduled workflows
2. `email_time_hour` - The hour (in UTC) when the workflow should run (0-23)
3. `email_time_minute` - Not currently used, but available for future fine-tuning

## Database Schema Updates

The script expects the following fields in the `users` table:

- `email_notifications` (boolean) - Whether the user wants scheduled workflows
- `email_time_hour` (integer) - Hour of the day to run the workflow (UTC, 0-23)
- `last_workflow_run` (timestamp) - When the workflow was last run
- `last_analysis_results` (jsonb) - Stored results from the last analysis
- `analysis_ready_for_email` (boolean) - Flag indicating if analysis is ready to be emailed
- `last_email_sent` (timestamp) - When the last email was sent

Run the included `update_users_table.sql` script to add these fields to your database schema.
