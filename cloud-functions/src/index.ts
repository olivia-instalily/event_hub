// EventHub functions server — Express app serving all 18 edge functions as HTTP routes.
// Caddy proxies /functions/v1/* here (stripping the /functions/v1 prefix).
// The DB client points at the internal Caddy port (9000) which routes /rest/v1/* to PostgREST.

import express from 'express';
import cors from 'cors';

import { handler as attachLuma }             from './functions/attach-luma.js';
import { handler as comparableLessons }      from './functions/comparable-lessons.js';
import { handler as createLuma }             from './functions/create-luma.js';
import { handler as detectUpdate }           from './functions/detect-update.js';
import { handler as extractBrief }           from './functions/extract-brief.js';
import { handler as extractDebrief }         from './functions/extract-debrief.js';
import { handler as gcalSync }               from './functions/gcal-sync.js';
import { handler as generatePage }           from './functions/generate-page.js';
import { handler as generatePageStyle }      from './functions/generate-page-style.js';
import { handler as generateTemplate }       from './functions/generate-template.js';
import { handler as gmailSync }              from './functions/gmail-sync.js';
import { handler as greenhouseSync }         from './functions/greenhouse-sync.js';
import { handler as linearSync }             from './functions/linear-sync.js';
import { handler as lumaImport }             from './functions/luma-import.js';
import { handler as lumaSync }               from './functions/luma-sync.js';
import { handler as planningSummary }        from './functions/planning-summary.js';
import { handler as slackApproval }          from './functions/slack-approval.js';
import { handler as slackChannels }          from './functions/slack-channels.js';
import { handler as slackEvents }            from './functions/slack-events.js';
import { handler as slackInteractions }      from './functions/slack-interactions.js';
import { handler as slackLinkChannel }       from './functions/slack-link-channel.js';
import { handler as slackSend }              from './functions/slack-send.js';
import { handler as slackScrape }            from './functions/slack-scrape.js';
import { handler as slackCommand }           from './functions/slack-command.js';
import { handler as eventMeetings }          from './functions/event-meetings.js';
import { handler as storageUpload }          from './functions/storage-upload.js';
import { handler as storageSign }            from './functions/storage-sign.js';
import { handler as summarizeCorrespondence} from './functions/summarize-correspondence.js';
import { authConfig, authGoogle, authMe, authLogout } from './functions/auth.js';

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['authorization', 'x-client-info', 'apikey', 'content-type'],
}));
// Slack signature verification needs the RAW body, so these routes must be registered with a raw
// parser BEFORE the global express.json() (which would otherwise consume the stream).
app.post('/slack-interactions', express.raw({ type: '*/*', limit: '2mb' }), slackInteractions);
app.post('/slack-events', express.raw({ type: '*/*', limit: '2mb' }), slackEvents);
app.post('/slack-command', express.raw({ type: '*/*', limit: '2mb' }), slackCommand);
// 20 MB limit — generate-page-style sends base64 images
app.use(express.json({ limit: '20mb' }));

app.get('/auth/config',   authConfig);
app.post('/auth/google',  authGoogle);
app.get('/auth/me',       authMe);
app.post('/auth/logout',  authLogout);

app.post('/attach-luma',              attachLuma);
app.post('/comparable-lessons',       comparableLessons);
app.post('/create-luma',              createLuma);
app.post('/detect-update',            detectUpdate);
app.post('/extract-brief',            extractBrief);
app.post('/extract-debrief',          extractDebrief);
app.post('/gcal-sync',                gcalSync);
app.post('/generate-page',            generatePage);
app.post('/generate-page-style',      generatePageStyle);
app.post('/generate-template',        generateTemplate);
app.post('/gmail-sync',               gmailSync);
app.post('/greenhouse-sync',          greenhouseSync);
app.post('/linear-sync',              linearSync);
app.post('/luma-import',              lumaImport);
app.post('/luma-sync',                lumaSync);
app.post('/planning-summary',         planningSummary);
app.post('/slack-approval',            slackApproval);
app.post('/slack-channels',           slackChannels);
app.post('/slack-link-channel',       slackLinkChannel);
app.post('/slack-send',               slackSend);
app.post('/slack-scrape',             slackScrape);
app.post('/event-meetings',           eventMeetings);
app.post('/storage-upload',           storageUpload);
app.post('/storage-sign',             storageSign);
app.post('/summarize-correspondence', summarizeCorrespondence);

app.get('/healthz', (_req, res) => res.json({ ok: true }));

const PORT = Number(process.env.FUNCTIONS_PORT ?? 3001);
app.listen(PORT, () => console.log(`Functions server listening on ${PORT}`));
