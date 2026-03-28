# 🔥 The Daily Roast

**Real Headlines. Unreal Stories.**

An AI-powered satirical news website that automatically fetches trending real news, transforms them into hilarious satirical articles using Google Gemini AI, and publishes them daily.

> ⚠️ **SATIRE DISCLAIMER**: This is a humor/parody website. All articles are entirely fictional, AI-generated content inspired by real headlines. Nothing published here is real journalism.

---

## 🏗️ Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  RSS News Feeds  │────▶│  Gemini AI API   │────▶│    Supabase     │
│  (Google News)   │     │  (Satirizes)     │     │  (Database)     │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
┌─────────────────┐     ┌──────────────────┐              │
│  Cloudflare     │◀────│  Static Frontend │◀─────────────┘
│  Pages (Host)   │     │  (HTML/CSS/JS)   │   (Reads articles)
└─────────────────┘     └──────────────────┘

GitHub Actions runs generation script daily (6AM + 6PM UTC)
```

## 🚀 Quick Setup

### 1. Supabase Database

1. Go to your [Supabase Dashboard](https://supabase.com/dashboard)
2. Open the **SQL Editor**
3. Copy and paste the contents of `scripts/setup-database.sql`
4. Click **Run** — this creates all tables, indexes, RLS policies, and seed data

Then run `scripts/setup-roast-automation.sql` in Supabase SQL Editor to create:
- `daily_roast_lock` (fixed daily winner snapshot)
- `weekly_roast_summaries` and `weekly_roast_items` (weekly Top 10)

For YouTube broadcast auto-upload, also run:
- `scripts/setup-youtube-broadcasts.sql`

### 2. Local Development

```bash
# Install dependencies
npm install

# Start local dev server
npm run dev
# Open http://localhost:3000
```

### 3. Test Article Generation (locally)

```bash
# Set environment variables
export GEMINI_API_KEY="your-gemini-api-key"
export SUPABASE_URL="https://pbwswrieljqfshnjulzs.supabase.co"
export SUPABASE_SERVICE_KEY="your-supabase-service-role-key"

# Generate articles
npm run generate

# Lock today's Roast of the Day snapshot
npm run lock-roast

# Generate weekly Top 10 summary
npm run weekly-top10

# Upload latest broadcast to YouTube (MP4 render + upload)
npm run youtube-upload
```

### 4. GitHub Repository Setup

```bash
git init
git add .
git commit -m "Initial commit: The Daily Roast"
git remote add origin https://github.com/YOUR_USERNAME/the-daily-roast.git
git push -u origin main
```

### 5. GitHub Secrets (Required for automation)

Go to your repo → **Settings** → **Secrets and variables** → **Actions**, and add:

| Secret Name | Value |
|---|---|
| `GEMINI_API_KEY` | Your Google Gemini API key |
| `SUPABASE_URL` | `https://pbwswrieljqfshnjulzs.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Your Supabase **service_role** key (found in Supabase Dashboard → Settings → API) |

### 6. Cloudflare Pages Deployment

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages**
2. Click **Create application** → **Pages** → **Connect to Git**
3. Select your GitHub repository
4. Configure build settings:
   - **Build command**: (leave empty — it's a static site)
   - **Build output directory**: `public`
   - **Root directory**: `/`
5. Click **Save and Deploy**

Cloudflare will automatically redeploy whenever you push to the `main` branch.

---

## 📂 Project Structure

```
├── public/                    # Static frontend (deployed to Cloudflare)
│   ├── index.html            # Homepage — article grid & featured stories
│   ├── article.html          # Individual article page
│   ├── robots.txt            # SEO robots file
│   ├── css/
│   │   └── style.css         # Complete design system
│   └── js/
│       ├── config.js         # Supabase config & utilities
│       ├── app.js            # Homepage logic
│       └── article.js        # Article page logic
├── scripts/
│   ├── setup-database.sql    # Supabase schema + seed data
│   ├── setup-roast-automation.sql # Daily lock + weekly Top 10 tables
│   └── generate-articles.mjs # AI article generation engine
├── .github/
│   └── workflows/
│       └── daily-content.yml # Automated daily generation
├── package.json
├── .gitignore
└── README.md
```

## 🤖 How AI Content Generation Works

### 1. News Discovery
- Fetches trending headlines from **7 Google News RSS feeds** (Top Stories, World, Tech, Business, Science, Entertainment, Sports)
- Parses and deduplicates headlines
- Cross-references against previously covered topics (72-hour window)

### 2. Topic Selection
- Selects 5 diverse topics (tries to cover different categories)
- Prioritizes variety to keep content interesting

### 3. Satirical Article Generation (Gemini AI)
- Sends each headline to **Gemini 2.0 Flash** with a carefully crafted prompt
- The prompt instructs the AI to:
  - Write in deadpan, professional news tone
  - Include fake quotes from fictional experts with funny names
  - Use escalating absurdity
  - End with an "at press time" kicker
  - Generate SEO-friendly metadata
- Outputs structured JSON with title, content, excerpt, tags, and category

### 4. Quality & Safety
- Content is humorous but never mean-spirited
- Punches up, not down
- Clear satirical framing throughout
- Every article marked as AI-generated satire

### 5. Storage & Publishing
- Articles saved to Supabase with full metadata
- Most recent article automatically featured
- Frontend reads from Supabase in real-time

## 🎨 Features

- **Professional Design** — Clean, modern news site layout
- **Responsive** — Works perfectly on mobile, tablet, and desktop
- **Satire Disclaimers** — Prominent banners and notices on every page
- **Category Filtering** — Politics, Tech, Business, Science, Entertainment, Sports, World
- **Breaking News Ticker** — Scrolling headlines bar
- **Social Sharing** — Twitter, Facebook, Reddit, copy link
- **SEO Optimized** — Schema.org structured data, Open Graph tags, meta descriptions
- **View Tracking** — Article view counts
- **Loading Skeletons** — Smooth loading experience
- **Semantic HTML** — Accessible and screen-reader friendly
- **Print Styles** — Articles print cleanly

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Required |
|---|---|---|
| `GEMINI_API_KEY` | Google Gemini API key | Yes |
| `SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_SERVICE_KEY` | Supabase service role key | Yes |
| `ARTICLES_COUNT` | Number of articles per run (default: 5) | No |
| `YT_CLIENT_ID` | Google OAuth Client ID for YouTube upload | For YouTube upload |
| `YT_CLIENT_SECRET` | Google OAuth Client Secret | For YouTube upload |
| `YT_REFRESH_TOKEN` | OAuth refresh token with YouTube upload scope | For YouTube upload |
| `YT_PRIVACY_STATUS` | `public`, `unlisted`, or `private` | No |
| `YT_PODCAST_PLAYLIST_ID` | YouTube playlist ID to also add each uploaded episode (optional) | No |
| `BGM_VOLUME` | Background music volume for generated radio audio (`0.10` = 10%) | No |
| `BGM_TRACKS_JSON` | JSON track catalog by theme (`upbeat/chill/funky/dramatic`) | No |
| `BGM_TRACK_UPBEAT` | Comma-separated fallback track URLs/paths for upbeat theme | No |
| `BGM_TRACK_CHILL` | Comma-separated fallback track URLs/paths for chill theme | No |
| `BGM_TRACK_FUNKY` | Comma-separated fallback track URLs/paths for funky theme | No |
| `BGM_TRACK_DRAMATIC` | Comma-separated fallback track URLs/paths for dramatic theme | No |
| `PLATFORM_PROMO_BRIEF` | Mid-show promo/sponsor writing brief used by script generator | No |
| `HOST_BIO_JOE` | Joe background/persona text used for script voice consistency | No |
| `HOST_BIO_JANE` | Jane background/persona text used for script voice consistency | No |
| `HOST_SHARED_HISTORY` | Shared duo backstory used for callbacks/chemistry | No |
| `HOST_MEMORY_BANK` | Reusable memories/running bits for natural callbacks and tangents | No |
| `TANGENT_STYLE_GUIDE` | Style rule for short off-topic memory/history detours | No |
| `TARGET_TANGENTS_PER_EPISODE` | Approx number of short tangents per episode (default: `3`, range: `1-6`) | No |
| `MEMORY_LOOKBACK_DAYS` | How far back to search previous broadcasts for topical continuity links (default: `14`) | No |
| `MEMORY_MAX_LINKS` | Maximum continuity links injected into prompt (default: `8`) | No |
| `BROADCAST_FORMAT` | Broadcast mode (`daily` or `sunday_special`) | No |
| `SUNDAY_DEEP_DIVE` | Enables deep-dive compare mode (`1`) for Sunday special episodes | No |
| `SCRIPT_MIN_LINES` | Lower script length target override for custom formats | No |
| `SCRIPT_MAX_LINES` | Upper script length target override for custom formats | No |
| `SUNDAY_UPLOAD_YOUTUBE` | For marathon orchestrator: upload each generated episode (`1`/`0`) | No |
| `ENABLE_EXTERNAL_RESEARCH` | Explicitly force external research on/off (`1`/`0`); default auto-enables only for Sunday deep-dive | No |
| `RUN_WEEKLY_TOP10_BEFORE_MARATHON` | Refresh weekly rankings before Sunday marathon starts (default: `1`) | No |
| `PROMO_PAUSE_SECONDS` | Silence inserted around promo segment when merging audio parts (default: `0.7`) | No |
| `PROMO_BUMPER_TRACK` | Optional audio file/URL used as a short jingle between merged script segments | No |
| `PROMO_BUMPER_SECONDS` | Max bumper clip duration used from `PROMO_BUMPER_TRACK` (default: `1.2`) | No |
| `PROMO_BUMPER_TRACK_MORNING` | Optional slot-specific bumper override for morning edition | No |
| `PROMO_BUMPER_TRACK_AFTERNOON` | Optional slot-specific bumper override for afternoon edition | No |
| `PROMO_BUMPER_TRACK_EVENING` | Optional slot-specific bumper override for evening edition | No |
| `SUNDAY_PROMO_BUMPER_TRACK` | Sunday marathon default bumper file/URL (defaults to `sounds/dragon-studio-whoosh-cinematic-376875.mp3`) | No |
| `PROMO_MODE` | Mid-roll mode: `platform` or `partner_challenge` | No |
| `PROMO_PARTNER_CHALLENGE` | Partner challenge CTA text used when `PROMO_MODE=partner_challenge` | No |

### Adjusting Generation Schedule

Article discovery + generation runs once per day from `.github/workflows/daily-content.yml`:

```yaml
schedule:
  - cron: '0 21 * * *'  # 00:00 Tallinn (DST period)
  - cron: '0 22 * * *'  # 00:00 Tallinn (standard time period)
```

Radio broadcast generation + YouTube upload runs 3x daily from `.github/workflows/scheduled-broadcasts.yml`.
Sunday marathon (3 shorter episodes + deep-dive segment) runs from `.github/workflows/sunday-marathon.yml`.

YouTube uploads now auto-generate lightweight chapter markers from script structure and duration (no extra AI/API calls), improving retention and navigation.

If `YT_PODCAST_PLAYLIST_ID` is set, each uploaded video is also added to that playlist.
For YouTube Podcasts, create or mark the playlist as a Podcast in YouTube Studio first.

Generated radio audio supports optional background music mixing with default volume at 10%.
Use free or licensed tracks from sources like Pixabay Music, Uppbeat, Artlist, or Epidemic and provide links via `BGM_TRACKS_JSON` (or `BGM_TRACK_*` fallback vars).
If no BGM env catalog is configured, the generator now falls back to built-in royalty-free default tracks so web + YouTube outputs stay consistent.

The radio web player now defaults to server-mixed audio only (client-side overlay BGM disabled by default) to avoid device-specific autoplay differences, especially on mobile browsers.

You can tune script personality and ad copy via prompt context env vars:
- `PLATFORM_PROMO_BRIEF` controls the mid-show platform/sponsor break style and message.
- `HOST_BIO_JOE`, `HOST_BIO_JANE`, and `HOST_SHARED_HISTORY` control host backstory and chemistry.
- `HOST_MEMORY_BANK`, `TANGENT_STYLE_GUIDE`, and `TARGET_TANGENTS_PER_EPISODE` control natural short detours into memories/history while keeping the script on-topic.
- `MEMORY_LOOKBACK_DAYS` and `MEMORY_MAX_LINKS` enable week-level topical memory so scripts can connect similar stories from previous days/weeks.
- For multiline values in GitHub Secrets, use `\n` for line breaks.

Example `BGM_TRACKS_JSON`:

```json
{
  "upbeat": ["https://example.com/upbeat-1.mp3", "https://example.com/upbeat-2.mp3"],
  "chill": ["https://example.com/chill-1.mp3"],
  "funky": ["https://example.com/funky-1.mp3"],
  "dramatic": ["https://example.com/dramatic-1.mp3"]
}
```

Weekly Top 10 generation runs from `.github/workflows/weekly-top10.yml`.

If you want to upload without generating a new broadcast (to avoid duplicate website posts), use:
- `.github/workflows/youtube-upload-only.yml`

To run Sunday marathon locally:

```bash
npm run broadcast:sunday
```

### Manual Article Generation

Go to GitHub → **Actions** → **Daily Content Generation** → **Run workflow**

You can specify a custom article count when triggering manually.

---

## 🔑 Finding Your Supabase Service Key

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to **Settings** → **API**
4. Under **Project API keys**, copy the `service_role` key (NOT the `anon` key)
5. ⚠️ The service_role key has full access — keep it SECRET and only use it in GitHub Secrets

---

## 📜 License

This project is for educational and entertainment purposes only. All generated content is AI-created satire.
