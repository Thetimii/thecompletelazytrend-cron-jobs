import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import dotenv from 'dotenv';
import SibApiV3Sdk from 'sib-api-v3-sdk';

// Load environment variables
dotenv.config();

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Initialize API client
const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3001/api';
const api = axios.create({
  baseURL: apiBaseUrl,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Initialize Brevo (formerly Sendinblue) email client
const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;
const emailApi = new SibApiV3Sdk.TransactionalEmailsApi();

/**
 * Run the complete workflow for a user
 * @param {Object} user - User object
 * @returns {Promise<Object>} - Workflow results
 */
async function runWorkflowForUser(user) {
  try {
    console.log(`Running workflow for user: ${user.email}`);

    // Skip if no business description
    if (!user.business_description) {
      console.log(`Skipping user ${user.email} - No business description`);
      return null;
    }

    // Call the complete workflow API
    console.log(`Calling API endpoint: ${apiBaseUrl}/api/complete-workflow`);

    // Use auth_id instead of id to properly identify the user
    // The backend expects userId to be the auth_id from Supabase Auth
    const userId = user.auth_id;

    if (!userId) {
      console.error(`No auth_id found for user: ${user.email}, id: ${user.id}`);
      throw new Error('User auth_id is required for workflow execution');
    }

    console.log(`Using auth_id: ${userId} for user: ${user.email}`);

    const response = await api.post('/api/complete-workflow', {
      businessDescription: user.business_description,
      userId: userId,
      videosPerQuery: 3 // Default to 3 videos per query
    });

    console.log(`Workflow completed for user: ${user.email}`);
    return response.data;
  } catch (error) {
    console.error(`Error running workflow for user ${user.email}:`, error.message);

    // Add more detailed error logging
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error(`Response status: ${error.response.status}`);
      console.error(`Response data:`, error.response.data);
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response received from server');
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('Error setting up request:', error.message);
    }

    return null;
  }
}

/**
 * Update the last workflow run timestamp for a user
 * @param {string} userId - User ID
 * @returns {Promise<void>}
 */
async function updateLastRunTimestamp(userId) {
  try {
    await supabase
      .from('users')
      .update({ last_workflow_run: new Date().toISOString() })
      .eq('id', userId);

    console.log(`Updated last_workflow_run for user: ${userId}`);
  } catch (error) {
    console.error(`Error updating last_workflow_run for user ${userId}:`, error.message);
  }
}

/**
 * Send email with analysis results to user
 * @param {Object} user - User object
 * @param {Object} analysisResults - Results from the workflow
 * @returns {Promise<boolean>} - Whether the email was sent successfully
 */
async function sendAnalysisEmail(user, analysisResults) {
  try {
    if (!user.email) {
      console.log('No email address found for user');
      return false;
    }

    // Extract relevant information from analysis results
    const { data } = analysisResults;
    const queriesCount = data?.searchQueries?.length || 0;
    const videosCount = data?.videosCount || 0;
    const marketingStrategy = data?.marketingStrategy || {};

    // Log the structure of the marketingStrategy object for debugging
    console.log('Marketing strategy structure:', JSON.stringify({
      keys: Object.keys(marketingStrategy),
      hasContentIdeas: !!marketingStrategy.content_ideas,
      hasContentIdeasAlt: !!marketingStrategy.contentIdeas,
      hasVideoIdeas: !!marketingStrategy.videoIdeas,
      hasCombinedSummary: !!marketingStrategy.combined_summary,
      hasCombinedSummaryAlt: !!marketingStrategy.combinedSummary
    }));

    // Create content for the email
    let contentIdeas = '';

    // Check different possible locations of content ideas
    const contentIdeasSource = marketingStrategy.content_ideas ||
                              marketingStrategy.contentIdeas ||
                              marketingStrategy.videoIdeas ||
                              [];

    // Parse content ideas if they're stored as a string
    let ideas = [];
    if (typeof contentIdeasSource === 'string') {
      try {
        // Try to parse as JSON
        ideas = JSON.parse(contentIdeasSource);
      } catch (e) {
        // If not valid JSON, split by newlines or use as a single item
        ideas = contentIdeasSource.includes('\n')
          ? contentIdeasSource.split('\n').filter(Boolean)
          : [contentIdeasSource];
      }
    } else if (Array.isArray(contentIdeasSource)) {
      ideas = contentIdeasSource;
    } else if (contentIdeasSource) {
      ideas = [contentIdeasSource];
    }

    // Generate HTML list items
    contentIdeas = ideas.map(idea => `<li>${idea}</li>`).join('');

    // Create a summary for the email
    const summary = marketingStrategy.combined_summary ||
                   marketingStrategy.combinedSummary ||
                   marketingStrategy.strategySummary ||
                   marketingStrategy.summary ||
                   'Analysis completed successfully.';

    // Create the email content
    const htmlContent = `
      <html>
        <body>
          <h1>Your TikTok Analysis Results</h1>
          <p>Hello ${user.full_name || 'there'},</p>
          <p>We've completed your scheduled TikTok trend analysis. Here's what we found:</p>

          <h2>Analysis Summary</h2>
          <p>${summary}</p>

          <h2>Stats</h2>
          <ul>
            <li>Search Queries Analyzed: ${queriesCount}</li>
            <li>TikTok Videos Analyzed: ${videosCount}</li>
          </ul>

          <h2>Content Ideas</h2>
          <ul>
            ${contentIdeas || '<li>No specific content ideas generated in this analysis.</li>'}
          </ul>

          <p>Log in to your dashboard to see the full analysis and more detailed recommendations.</p>

          <p>Best regards,<br>The Complete Lazy Trend Team</p>
        </body>
      </html>
    `;

    // Set up the email
    const sendSmtpEmail = {
      to: [{ email: user.email, name: user.full_name || user.email }],
      sender: {
        email: process.env.EMAIL_SENDER || 'noreply@lazy-trends.com',
        name: 'The Complete Lazy Trend'
      },
      subject: 'Your TikTok Trend Analysis Results',
      htmlContent: htmlContent
    };

    // Send the email
    const response = await emailApi.sendTransacEmail(sendSmtpEmail);
    console.log(`Email sent to ${user.email}`, response);
    return true;
  } catch (error) {
    console.error(`Error sending email to ${user.email}:`, error.message);
    return false;
  }
}

/**
 * Main function to run scheduled workflows
 */
async function runScheduledWorkflows() {
  try {
    console.log('Starting scheduled workflow execution...');

    // Get current hour in UTC
    const now = new Date();
    const currentHour = now.getUTCHours();

    // Calculate the hour for which we should run the analysis
    // (one hour ahead of current time, since we run analysis 1 hour before email time)
    const targetEmailHour = (currentHour + 1) % 24;

    console.log(`Current hour: ${currentHour}, Target email hour: ${targetEmailHour}`);

    // Fetch users who have opted in for scheduled workflow at the target hour
    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .eq('email_notifications', true)
      .eq('email_time_hour', targetEmailHour);

    if (error) {
      throw error;
    }

    console.log(`Found ${users.length} users scheduled for email at hour ${targetEmailHour}`);

    // Run workflow for each user
    for (const user of users) {
      console.log(`Processing user ${user.email} - scheduled for email at ${targetEmailHour}:00 UTC`);

      // Run the workflow
      const result = await runWorkflowForUser(user);

      if (result) {
        // Update the last run timestamp
        await updateLastRunTimestamp(user.id);

        // Store the analysis results for email sending
        await supabase
          .from('users')
          .update({
            last_analysis_results: result,
            analysis_ready_for_email: true
          })
          .eq('id', user.id);

        console.log(`Analysis completed and stored for user ${user.email}`);
      }
    }

    // Now check for users who should receive emails this hour
    const { data: emailUsers, error: emailError } = await supabase
      .from('users')
      .select('*')
      .eq('email_notifications', true)
      .eq('email_time_hour', currentHour)
      .eq('analysis_ready_for_email', true);

    if (emailError) {
      throw emailError;
    }

    console.log(`Found ${emailUsers?.length || 0} users to send emails to this hour`);

    // Send emails to users
    for (const user of (emailUsers || [])) {
      // Get the stored analysis results
      const analysisResults = user.last_analysis_results;

      if (analysisResults) {
        // Send the email
        const emailSent = await sendAnalysisEmail(user, analysisResults);

        if (emailSent) {
          // Update the last email sent timestamp and reset the flag
          await supabase
            .from('users')
            .update({
              last_email_sent: new Date().toISOString(),
              analysis_ready_for_email: false
            })
            .eq('id', user.id);

          console.log(`Email sent and status updated for user ${user.email}`);
        }
      } else {
        console.log(`No analysis results found for user ${user.email}`);
      }
    }

    console.log('Scheduled workflow execution completed');
  } catch (error) {
    console.error('Error running scheduled workflows:', error.message);
  }
}

// Execute the main function
runScheduledWorkflows().catch(console.error);
