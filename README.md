# Muse Wear

A designer clothing shop you run yourself. Customers browse the collection, choose a size and pay by card. You add pieces, upload films, and go live from your phone or laptop camera so people can watch you try things on and buy straight from the stream.

It runs on **Vercel** (recommended) or on your own computer.

## What's in it

**The shop**
- Homepage with a full-width hero picture or film, new arrivals, the latest films and category tiles
- Shop page with category filters and sorting
- Product pages with a photo gallery, size picker, and drop-downs for description, composition and care, and delivery
- A bag that slides out from the side and remembers what people added
- Card payments through Stripe Checkout, including Apple Pay and Google Pay, with the shipping address collected at checkout
- Films page, and films linked to a product show on that product's page
- Live page: watch the stream, chat, and add the piece being worn to the bag without leaving

**The admin area (`/admin`)**
- Sales, orders to ship and low stock at a glance
- Products with up to 8 photos each (the first is the cover, the second appears on hover), sizes, stock, description and care details
- Film uploads, linked to a product if you like
- Orders with the customer's name, email and address, and a button to mark them shipped
- Homepage: the hero picture or film, headline, top banner, about text, delivery info and Instagram link
- Go live: camera preview, switch cameras, mute, pick the piece viewers can buy, reply in chat, and a replay saved to Films when you finish

Until a product has photos, the shop shows a line drawing of the garment on the colour you pick, so it still looks finished on day one.

## Putting it on Vercel

You'll need a free [Vercel](https://vercel.com) account connected to your GitHub.

1. **Import the project.** In Vercel, click *Add New > Project* and pick this GitHub repository. Leave every build setting as it is (the included `vercel.json` handles it) and click *Deploy*. The first deploy will load, but admin and checkout won't work until the next steps are done.
2. **Add a database.** In the project, open the *Storage* tab, choose *Create Database*, pick **Neon** (Postgres) and connect it to the project. Vercel adds `DATABASE_URL` for you. The tables and starter products are created automatically the first time the site is visited.
3. **Add file storage.** Still in *Storage*, create a **Blob** store and connect it. Vercel adds `BLOB_READ_WRITE_TOKEN`. Photos and films go here.
4. **Set your password.** In *Settings > Environment Variables*, add `ADMIN_PASSWORD` with something long. Add `STORE_NAME` too if you want a different name.
5. **Redeploy.** Go to *Deployments*, open the menu on the latest one and choose *Redeploy* so the new settings take effect.

Then open `your-project.vercel.app/admin`, sign in and start adding your pieces. To use your own domain, add it under *Settings > Domains*.

### Taking real payments

The shop starts in test mode: checkout works but nobody is charged, and a note at the top of the site says so.

1. Create a [Stripe](https://stripe.com) account and finish their business details so payouts can reach your bank.
2. In Stripe, go to *Developers > API keys* and copy the **secret key**. Add it in Vercel as `STRIPE_SECRET_KEY`. Use the `sk_test_...` key first if you want to try it with Stripe's test card (4242 4242 4242 4242, any future date, any CVC), then swap in the `sk_live_...` key.
3. In Stripe, go to *Developers > Webhooks*, add an endpoint at `https://your-domain/api/stripe/webhook`, and choose the events `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Copy its signing secret into Vercel as `STRIPE_WEBHOOK_SECRET`. This marks orders paid even if a customer closes the tab right after paying.
4. Set `CURRENCY` (for example `gbp` or `eur`) and `SHIP_COUNTRIES` (for example `GB,IE,FR`) if the defaults don't suit you.
5. Redeploy.

### What the free plans cover

- **Blob storage** is where most of your allowance goes, because films are large. Keep films short (under a minute works well for product films) and export them at 1080p or lower. Live replays are saved automatically, so delete the ones you don't need, or untick "Save a replay" before going live.
- **Neon's** free database is plenty for a small shop.
- **Livestreams** make each viewer's browser check in with the server every second or two. That's fine for small audiences on the free plan. If you regularly get dozens of viewers for an hour at a time, keep an eye on usage in the Vercel dashboard.

## Going live

1. Open `/admin` on the phone or laptop you'll stream from and go to **Go live**.
2. Turn the camera on, give the stream a title and press **Go live**.
3. Choose a piece under "Piece viewers can buy right now". It appears over the video with an Add to bag button. Change it as you try on different things.
4. Press **End stream** when you're done. If "Save a replay" was ticked, the recording is uploaded to Films automatically.

Good to know:

- The video goes straight from your device to each viewer, so your **upload speed** decides how many people can watch smoothly. Roughly 1.2 Mbps per viewer: a 20 Mbps upload handles about 15 people well. Viewers are capped at 60.
- Keep the admin tab open and in front while you're live. Phones pause the camera when you switch apps, and the stream ends if the studio goes quiet for 45 seconds.
- Some viewers on strict office or mobile networks may not get the video. If that happens a lot, sign up for a TURN relay (Metered, Twilio and Cloudflare all have one) and add `TURN_URL`, `TURN_USERNAME` and `TURN_CREDENTIAL`.
- Video takes a few seconds to appear for each new viewer. That's the price of running without a dedicated streaming server. If you outgrow it, the next step is a streaming service such as Mux, LiveKit or Cloudflare Stream.

## Running it on your own computer

You need Node.js 20 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000 for the shop and http://localhost:3000/admin to manage it. The terminal prints a temporary admin password. To keep settings between runs, copy `.env.example` to `.env` and fill it in.

Locally, the shop uses a built-in copy of Postgres stored in `data/` and saves uploads in `uploads/`, so no accounts are needed. If you put `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` from Vercel in your `.env`, your computer works on the live shop's data instead.

## Project layout

```
api/index.js        entry point Vercel runs for every /api request
server.js           entry point when running it yourself
vercel.json         Vercel settings
src/app.js          the web app
src/config.js       reads settings
src/db.js           database tables, starter products and homepage text
src/routes.js       shop and admin API
src/payments.js     checkout, Stripe and marking orders paid
src/live.js         live stream setup, chat and the pinned piece
src/storage.js      photo and film uploads (Vercel Blob or local folder)
public/             the website itself
public/js/vendor/   Vercel's upload helper, prebuilt for the browser (npm run bundle-blob-client)
```

The eight starter pieces are there so the shop doesn't look empty at first. Edit or delete them once you've added your own.
