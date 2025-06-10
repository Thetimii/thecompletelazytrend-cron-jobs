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

// Helper functions to format marketing strategy to HTML
function cleanListItemText(text) {
  return text.replace(/^- /, '').replace(/\\n/g, ' ').trim();
}

function createListHtml(str, title) {
  if (typeof str !== 'string' || !str.trim()) return `<p>No ${title.toLowerCase()} provided.</p>`;
  
  let cleanedStr = str.replace(/\*\*/g, ''); // Remove all bold markers
  cleanedStr = cleanedStr.replace(/^\s*\d\.\s*([\w\s()]+:)?/i, ''); // Remove leading "1. Title:" or "1. "
  cleanedStr = cleanedStr.replace(/---/g, '').trim(); // Remove "---"

  const items = cleanedStr.split('\\n- ')
    .map(item => cleanListItemText(item))
    .filter(item => item);

  if (items.length === 0 || (items.length === 1 && cleanedStr.indexOf('\\n- ') === -1)) {
    // If no list items or it's a single block of text not starting with list markers
    return `<p>${cleanedStr.replace(/\\n/g, '<br>')}</p>`;
  }

  let listHtml = '<ul>';
  items.forEach(itemText => {
    if (itemText) {
      listHtml += `<li>${itemText}</li>`;
    }
  });
  listHtml += '</ul>';
  return listHtml;
}

function formatSampleScriptHtml(scriptStr) {
  if (typeof scriptStr !== 'string' || !scriptStr.trim()) return '<p>No sample script provided.</p>';
  let html = '';
  const cleanedScriptStr = scriptStr.replace(/\*\*/g, ''); // Remove bold markers globally first

  const visualCuesMatch = cleanedScriptStr.match(/Visual Cues:([\s\S]*?)(Voiceover\/Script:|$)/i);
  const voiceoverMatch = cleanedScriptStr.match(/Voiceover\/Script:([\s\S]*)/i);

  if (visualCuesMatch && visualCuesMatch[1] && visualCuesMatch[1].trim()) {
    html += '<h4>Visual Cues:</h4><ul>';
    visualCuesMatch[1].split('\\n- ')
      .map(line => cleanListItemText(line))
      .filter(line => line)
      .forEach(item => {
        html += `<li>${item}</li>`;
      });
    html += '</ul>';
  } else {
    html += '<h4>Visual Cues:</h4><p>Not specified.</p>';
  }

  if (voiceoverMatch && voiceoverMatch[1] && voiceoverMatch[1].trim()) {
    html += '<h4>Voiceover/Script:</h4>';
    const voiceoverContent = voiceoverMatch[1].replace(/\\n/g, '<br>').replace(/\*"/g, '"').trim();
    html += `<p>${voiceoverContent}</p>`;
  } else {
    html += '<h4>Voiceover/Script:</h4><p>Not specified.</p>';
  }
  return html;
}

function formatContentThemesHtml(themesInput) {
  let themes = [];
  if (Array.isArray(themesInput)) {
    themes = themesInput;
  } else if (typeof themesInput === 'string') {
    try {
      themes = JSON.parse(themesInput); // If it's a JSON string array
    } catch (e) {
      themes = themesInput.split('\\n- ')
                    .map(theme => theme.replace(/^\s*\*\s*/, '').replace(/\*\*/g, '').trim())
                    .filter(theme => theme && theme !== '*' && theme !== '--');
    }
  }

  if (!Array.isArray(themes) || themes.length === 0) return '<p>No specific themes provided.</p>';

  let html = '<ul>';
  themes.forEach(theme => {
    if (typeof theme === 'string') {
      const cleanedTheme = theme.replace(/^\s*[\d.]*\s*\*\s*/, '')
                                 .replace(/\*\*/g, '')
                                 .replace(/^- /, '')
                                 .trim();
      if (cleanedTheme && cleanedTheme.length > 1 && cleanedTheme !== '*' && cleanedTheme !== '--' && !cleanedTheme.match(/^\d+\.$/)) {
        html += `<li>${cleanedTheme}</li>`;
      }
    }
  });
  html += '</ul>';
  return html.includes('<li>') ? html : '<p>No specific themes provided.</p>';
}

function formatHashtagStrategyHtml(str) {
  if (typeof str !== 'string' || !str.trim()) return '<p>No hashtag strategy provided.</p>';
  let html = '';
  const cleanedStr = str.replace(/\*\*/g, ''); // Remove bold markers

  const sectionTitles = ["Primary (Niche):", "Secondary (Trending/Regional):", "Broad Appeal:"];
  let currentTitle = null;
  let currentHashtags = [];
  let foundContent = false;

  cleanedStr.split('\\n').forEach(line => {
    line = line.trim();
    let isTitle = false;
    for (const title of sectionTitles) {
      if (line.startsWith(title)) {
        if (currentTitle && currentHashtags.length > 0) {
          html += `<h4>${currentTitle}</h4><ul>`;
          currentHashtags.forEach(tag => html += `<li>${tag}</li>`);
          html += '</ul>';
          foundContent = true;
        } else if (currentTitle) {
           html += `<h4>${currentTitle}</h4><p>No specific hashtags listed.</p>`;
        }
        currentTitle = title;
        currentHashtags = [];
        const contentAfterTitle = line.substring(title.length).trim();
        if (contentAfterTitle.startsWith("- ")) {
            currentHashtags.push(cleanListItemText(contentAfterTitle));
        } else if (contentAfterTitle) {
            // currentHashtags.push(contentAfterTitle); // Avoid adding empty lines or placeholders
        }
        isTitle = true;
        break;
      }
    }

    if (!isTitle && currentTitle && line && !line.startsWith("---") && !line.match(/^\s*\d\.\s*$/) && line.toLowerCase() !== "(e. g.," && line.toLowerCase() !== "(e.g.,") {
      if (line.startsWith("- ")) {
        currentHashtags.push(cleanListItemText(line));
      } else { // If not a list item, could be a single tag or part of a previous one.
        // currentHashtags.push(line); // Avoid adding fragmented lines as separate tags
      }
    }
  });

  // Add the last section
  if (currentTitle && currentHashtags.length > 0) {
    html += `<h4>${currentTitle}</h4><ul>`;
    currentHashtags.forEach(tag => html += `<li>${tag}</li>`);
    html += '</ul>';
    foundContent = true;
  } else if (currentTitle) {
     html += `<h4>${currentTitle}</h4><p>No specific hashtags listed.</p>`;
  }
  
  return foundContent || html.includes("<h4>") ? html : '<p>No hashtag strategy provided.</p>';
}


function formatMarketingStrategyToHtml(marketingStrategy) {
  if (!marketingStrategy || Object.keys(marketingStrategy).length === 0) {
    return "<h2>Marketing Strategy & Content Ideas</h2><p>No detailed strategy information available.</p>";
  }
  let emailBodyHtml = '<h2>Marketing Strategy & Content Ideas</h2>';

  const sections = [
    { title: 'Observations', key: 'observations', processor: (content) => createListHtml(content, 'Observations') },
    { title: 'Key Trend Takeaways', key: 'keyTakeaways', processor: (content) => createListHtml(content, 'Key Trend Takeaways') },
    { title: 'Sample TikTok Script', key: 'sampleScript', processor: formatSampleScriptHtml },
    { title: 'Technical Specifications', key: 'technicalSpecifications', processor: (content) => createListHtml(content, 'Technical Specifications') },
    { title: 'General Content Themes', key: 'contentThemes', processor: formatContentThemesHtml },
    { title: 'Hashtag Strategy', key: 'hashtagStrategy', processor: formatHashtagStrategyHtml },
    { title: 'Posting Frequency', key: 'postingFrequency', processor: (content) => createListHtml(content, 'Posting Frequency') }
  ];

  let hasContent = false;
  for (const section of sections) {
    const content = marketingStrategy[section.key] || (section.key === 'observations' ? marketingStrategy['rawContent'] : null) ;
    if (content) {
      const sectionHtml = section.processor(content);
      if (sectionHtml && !sectionHtml.toLowerCase().includes("no information provided") && !sectionHtml.toLowerCase().includes("not specified") && !sectionHtml.toLowerCase().includes("no specific")) {
        emailBodyHtml += `<h3>${section.title}</h3>`;
        emailBodyHtml += sectionHtml;
        hasContent = true;
      }
    }
  }
   if (!hasContent) {
    return "<h2>Marketing Strategy & Content Ideas</h2><p>No detailed strategy information available at this time.</p>";
  }


  // Add the final concluding line from postingFrequency if it exists and isn't captured
  if (marketingStrategy.postingFrequency && typeof marketingStrategy.postingFrequency === 'string') {
    const match = marketingStrategy.postingFrequency.match(/This strategy balances[\s\S]*/i);
    if (match && match[0]) {
      emailBodyHtml += `<p>${match[0].replace(/\*\*/g, '').replace(/\\n/g, ' ').trim()}</p>`;
    }
  }

  emailBodyHtml = emailBodyHtml.replace(/\\n/g, '<br>');
  emailBodyHtml = emailBodyHtml.replace(/(<br>\s*){2,}/g, '<br>');
  emailBodyHtml = emailBodyHtml.replace(/<p><br><\/p>/g, '');
  return emailBodyHtml;
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

    const { data } = analysisResults; // This 'data' is the actual result from complete-workflow
    const queriesCount = data?.searchQueries?.length || 0;
    const videosCount = data?.videosCount || 0;
    const marketingStrategyData = data?.marketingStrategy || {};

    console.log('Raw marketingStrategyData for formatting:', JSON.stringify(marketingStrategyData));

    const formattedStrategyHtml = formatMarketingStrategyToHtml(marketingStrategyData);

    // Create the email content
    const htmlContent = `
      <html>
        <head>
          <style>
            body { font-family: sans-serif; line-height: 1.6; color: #333; }
            h1 { color: #1a1a1a; }
            h2 { color: #2c2c2c; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 30px;}
            h3 { color: #444; margin-top: 25px; }
            h4 { color: #555; margin-top: 20px; }
            ul { margin-left: 20px; padding-left: 0; }
            li { margin-bottom: 8px; }
            p { margin-bottom: 12px; }
            .container { max-width: 700px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
            .footer { margin-top: 30px; font-size: 0.9em; color: #777; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Your TikTok Analysis Results</h1>
            <p>Hello ${user.full_name || 'there'},</p>
            <p>We've completed your scheduled TikTok trend analysis. Here's what we found:</p>

            <h2>Analysis Stats</h2>
            <ul>
              <li>Search Queries Analyzed: ${queriesCount}</li>
              <li>TikTok Videos Analyzed: ${videosCount}</li>
            </ul>

            ${formattedStrategyHtml}

            <p class="footer">Log in to your dashboard to see the full analysis and more detailed recommendations.</p>
            <p class="footer">Best regards,<br>The Complete Lazy Trend Team</p>
          </div>
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
 * Convert a local time to UTC
 * @param {number} hour - Hour in local time (0-23)
 * @param {string} timezone - IANA timezone string (e.g., 'America/New_York')
 * @returns {number} - Hour in UTC (0-23)
 */
function convertLocalToUTC(localHour, timezone) {
  try {
    // Iterate through UTC hours to find the one that matches the user's local hour in their timezone
    for (let utcHourCandidate = 0; utcHourCandidate < 24; utcHourCandidate++) {
      const date = new Date();
      date.setUTCHours(utcHourCandidate, 0, 0, 0); // Set to a candidate UTC hour

      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric', // Get hour in target timezone
        hour12: false
      });
      const hourInUserTimezone = parseInt(formatter.format(date));

      if (hourInUserTimezone === localHour) {
        console.log(`Converted local time ${localHour}:00 in timezone ${timezone} to UTC hour: ${utcHourCandidate}:00`);
        return utcHourCandidate;
      }
    }
    // Fallback or error if no match (should not happen for valid timezones/hours on standard dates)
    console.error(`Could not accurately convert local time ${localHour}:00 in timezone ${timezone} to UTC. Using original hour as fallback.`);
    return localHour; // Fallback to the original hour if conversion isn't found (e.g. during DST transitions for non-existent hours)
  } catch (error) {
    console.error(`Error converting time for timezone ${timezone}:`, error);
    return localHour; // Return the original hour if conversion fails
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
    console.log(`Current UTC hour: ${currentHour}`);

    // Fetch all users who have opted in for scheduled workflow
    const { data: allUsers, error } = await supabase
      .from('users')
      .select('*')
      .eq('email_notifications', true);

    if (error) {
      throw error;
    }

    console.log(`Found ${allUsers.length} users with email notifications enabled`);

    // Filter users based on their timezone and preferred hour
    const usersForAnalysis = [];
    const usersForEmail = [];

    for (const user of allUsers) {
      // Skip users without timezone (use UTC as fallback)
      const timezone = user.timezone || 'UTC';
      const localHour = user.email_time_hour || 9; // Default to 9 AM if not specified

      // Convert the user's preferred local hour to UTC
      const utcHour = convertLocalToUTC(localHour, timezone);

      // Calculate the hour for which we should run the analysis
      // (one hour before the email time)
      const analysisHour = (utcHour - 1 + 24) % 24;

      console.log(`User ${user.email}: Local time ${localHour}:00, UTC time ${utcHour}:00, Analysis time ${analysisHour}:00 UTC`);

      // Check if it's time to run analysis for this user
      if (analysisHour === currentHour) {
        usersForAnalysis.push(user);
      }

      // Check if it's time to send email for this user
      if (utcHour === currentHour) {
        usersForEmail.push(user);
      }
    }

    console.log(`Found ${usersForAnalysis.length} users for analysis this hour`);
    console.log(`Found ${usersForEmail.length} users for email this hour`);

    // Run workflow for each user scheduled for analysis
    for (const user of usersForAnalysis) {
      console.log(`Processing analysis for user ${user.email}`);
      const result = await runWorkflowForUser(user);

      if (result && Object.keys(result).length > 0) {
        console.log(`Workflow for user ${user.email} completed successfully. Result keys: ${Object.keys(result)}. Storing analysis.`);
        await updateLastRunTimestamp(user.id);
        await supabase
          .from('users')
          .update({
            last_analysis_results: result,
            analysis_ready_for_email: true
          })
          .eq('id', user.id);
        console.log(`Analysis completed and stored for user ${user.email}`);
      } else {
        console.log(`Workflow for user ${user.email} did not return a valid result (result is null, empty, or falsy). Analysis not stored, 'analysis_ready_for_email' flag not set.`);
      }
    }

    // Send emails to users scheduled for email
    for (const user of usersForEmail) {
      console.log(`Processing email for user ${user.email}`);

      if (user.analysis_ready_for_email && user.last_analysis_results && Object.keys(user.last_analysis_results).length > 0) {
        const analysisResults = user.last_analysis_results;
        console.log(`Found analysis results for user ${user.email} ('analysis_ready_for_email' is true). Proceeding to send email.`);
        const emailSent = await sendAnalysisEmail(user, analysisResults);

        if (emailSent) {
          await supabase
            .from('users')
            .update({
              last_email_sent: new Date().toISOString(),
              analysis_ready_for_email: false // Reset the flag
            })
            .eq('id', user.id);
          console.log(`Email sent and status updated for user ${user.email}`);
        } else {
          console.log(`Email sending API call failed for user ${user.email} after attempting.`);
        }
      } else {
        console.log(`Skipping email for user ${user.email} due to missing prerequisites:`);
        if (!user.analysis_ready_for_email) {
          console.log(`  - 'analysis_ready_for_email' flag is false or missing.`);
        }
        if (!user.last_analysis_results || Object.keys(user.last_analysis_results).length === 0) {
          console.log(`  - 'last_analysis_results' is missing, null, or empty.`);
        }
      }
    }

    console.log('Scheduled workflow execution completed');
  } catch (error) {
    console.error('Error running scheduled workflows:', error);
  }
}

// Execute the main function
runScheduledWorkflows().catch(console.error);
