# Quick Start Guide

Get your AI SEO Blog Automation up and running in 5 minutes!

## Step 1: Configure Environment

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
nano .env  # or use your preferred editor
```

Required variables:
- `FIRECRAWL_API_KEY` - Get from https://firecrawl.dev
- `GROQ_API_KEY` - Get from https://console.groq.com
- `WP_SITE_URL` - Your WordPress site URL (e.g., https://yoursite.com/blog)
- `WP_USER` - Your WordPress username
- `WP_APP_PASSWORD` - WordPress Application Password (not regular password!)

### Creating WordPress Application Password

1. Log into WordPress admin
2. Go to Users → Profile
3. Scroll to "Application Passwords"
4. Enter a name (e.g., "AI SEO Bot")
5. Click "Add New Application Password"
6. Copy the generated password to your `.env` file

## Step 2: Start the Server

```bash
node index.js
```

You should see:

```
╔════════════════════════════════════════════════════════════╗
║   🚀 AI SEO Blog Automation Server                         ║
╠════════════════════════════════════════════════════════════╣
║   Server: http://localhost:8787                            ║
║   Daily Post Time: 10:00                                   ║
...
```

## Step 3: Populate the Queue

In a new terminal, fetch URLs from SecurityWeek:

```bash
curl -X POST http://localhost:8787/fetch-urls
```

This will scrape SecurityWeek and add URLs 5-13 to your queue (9 URLs total).

## Step 4: Test Posting

Post your first article:

```bash
# As a draft (to review first)
curl -X POST http://localhost:8787/post-from-queue \
  -H "Content-Type: application/json" \
  -d '{"publish": false}'

# Or publish immediately
curl -X POST http://localhost:8787/post-from-queue \
  -H "Content-Type: application/json" \
  -d '{"publish": true}'
```

## Step 5: Check Queue Status

```bash
curl http://localhost:8787/queue-status
```

## That's It!

Your system is now running and will:
- ✅ Automatically post 1 article per day at the configured hour
- ✅ Pull from the queue in FIFO order
- ✅ Auto-refetch URLs when queue is empty

## Next Steps

### View Logs

Keep an eye on the server console to see what's happening:

```bash
# The server logs everything it does
```

### Use the Test Script

We've included a handy test script:

```bash
./test-queue.sh
```

This interactive script will guide you through:
- Checking server health
- Viewing queue status
- Fetching URLs
- Posting articles

### Change Daily Post Time

Edit your `.env` file:

```env
DAILY_POST_HOUR=14  # Posts at 2 PM instead of 10 AM
```

Then restart the server.

### Deploy for Production

For production, use a process manager:

#### Option 1: PM2 (Recommended)

```bash
npm install -g pm2
pm2 start index.js --name ai-seo-blog
pm2 save
pm2 startup  # Follow the instructions
```

#### Option 2: systemd

See the full README for systemd configuration.

## Common Commands

```bash
# Check if server is running
curl http://localhost:8787/healthz

# View queue
curl http://localhost:8787/queue-status

# Fetch new URLs
curl -X POST http://localhost:8787/fetch-urls

# Post on demand (draft)
curl -X POST http://localhost:8787/post-from-queue \
  -H "Content-Type: application/json" \
  -d '{"publish": false}'

# Post on demand (publish)
curl -X POST http://localhost:8787/post-from-queue \
  -H "Content-Type: application/json" \
  -d '{"publish": true}'
```

## Troubleshooting

### "Failed to get URL from queue"

Your queue is empty. Fetch URLs first:

```bash
curl -X POST http://localhost:8787/fetch-urls
```

### "Firecrawl account is not permitted"

Contact Firecrawl support to enable the domain you're trying to scrape.

### WordPress authentication failed

1. Verify your `WP_SITE_URL` is correct (with /blog if needed)
2. Check your `WP_USER` is correct
3. Make sure you're using an Application Password, not your regular password
4. Test WordPress REST API: `curl https://yoursite.com/blog/wp-json/wp/v2/posts`

### Daily post not triggering

1. Check the server is still running
2. Verify `DAILY_POST_HOUR` is set correctly
3. Check queue has URLs: `curl http://localhost:8787/queue-status`
4. Look at server logs for any errors

## Need Help?

Check the full [README.md](README.md) for detailed documentation.


