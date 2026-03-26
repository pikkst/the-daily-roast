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

### Adjusting Generation Schedule

Article discovery + generation runs once per day from `.github/workflows/daily-content.yml`:

```yaml
schedule:
  - cron: '0 21 * * *'  # 00:00 Tallinn (DST period)
  - cron: '0 22 * * *'  # 00:00 Tallinn (standard time period)
```

Radio broadcast generation + YouTube upload runs 3x daily from `.github/workflows/scheduled-broadcasts.yml`.

If `YT_PODCAST_PLAYLIST_ID` is set, each uploaded video is also added to that playlist.
For YouTube Podcasts, create or mark the playlist as a Podcast in YouTube Studio first.

Generated radio audio supports optional background music mixing with default volume at 10%.
Use free or licensed tracks from sources like Pixabay Music, Uppbeat, Artlist, or Epidemic and provide links via `BGM_TRACKS_JSON` (or `BGM_TRACK_*` fallback vars).

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
