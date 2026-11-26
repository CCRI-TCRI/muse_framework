# Muse Wear

A clothing shop you run yourself, built to feel like a phone app. Customers browse, choose a size and place an order, then confirm it with you on WhatsApp and pay by Mobile Money or cash on delivery. You add pieces, upload films, and go live from your phone so people can watch you try things on and buy straight from the stream. Prices are in Ugandan shillings.

It runs on **Vercel** (recommended) or on your own computer.

## What's in it

**The shop**
- Mobile app style: greeting header, search, a floating bottom menu, and a bag that slides up from the bottom
- Homepage with a colourful banner (your own picture or film, or your newest pieces), category buttons, new items, category tiles and films
- Shop page with search, category filters and sorting, plus a Saved list for pieces people heart
- Product pages with a photo gallery, sizes, quantity, sale prices, and Buy now
- **Checkout through WhatsApp**: customers give their name, phone and delivery location and place the order. The next screen asks them to call or WhatsApp your numbers, with buttons that open WhatsApp with the whole order already written out
- Live page: watch the stream, chat, and add the piece being worn to the bag without leaving

**The admin dashboard (`/admin`)**, with its own sidebar layout that turns into a top bar on phones
- Overview: total sales, this week's sales, new orders, orders to deliver, latest orders and pieces running low
- Orders: New, Paid, Delivered and Cancelled. Each order has a WhatsApp button to message the customer, plus Mark paid, Mark delivered and Cancel. Stock comes down when you mark an order paid
- Products with up to 8 photos each, a "was" price for discounts, sizes, stock, description and care details
- Films, linked to a product if you like
- Live studio: camera preview, switch cameras, mute, pick the piece viewers can buy, reply in chat, and a replay saved to Films when you finish
- Shop settings: your WhatsApp numbers, delivery and payment info, the top banner, and the homepage banner and text

Until a product has photos, the shop shows a line drawing of the garment on the colour you pick, so it still looks finished on day one.

## Putting it on Vercel

You'll need a free [Vercel](https://vercel.com) account connected to your GitHub.

1. **Import the project.** In Vercel, click *Add New > Project* and pick this GitHub repository. Leave every build setting as it is (the included `vercel.json` handles it) and click *Deploy*. The first deploy will load, but admin and checkout won't work until the next steps are done.
2. **Add a database.** In the project, open the *Storage* tab, choose *Create Database*, pick **Neon** (Postgres) and connect it to the project. Vercel adds `DATABASE_URL` for you. The tables and starter products are created automatically the first time the site is visited.
3. **Add file storage.** Still in *Storage*, create a **Blob** store and connect it. Vercel adds `BLOB_READ_WRITE_TOKEN`. Photos and films go here.
4. **Set your password.** In *Settings > Environment Variables*, add `ADMIN_PASSWORD` with something long. Add `STORE_NAME` too if you want a different name, and `CURRENCY` if you don't sell in Ugandan shillings.
5. **Redeploy.** Go to *Deployments*, open the menu on the latest one and choose *Redeploy* so the new settings take effect.

Then open `your-project.vercel.app/admin`, sign in and start adding your pieces. To use your own domain, add it under *Settings > Domains*.

### How orders and payment work

There's no card payment. When a customer places an order it shows up in admin under **Orders > New**, and the customer is asked to call or WhatsApp the numbers in **Shop settings** (0744 315492 and 0795567578 to start with). Once they've paid by Mobile Money, or you've agreed cash on delivery, press **Mark paid**. That takes the items out of stock. Press **Mark delivered** when it arrives.

Stock is checked when an order is placed, but only taken off when you mark it paid, so two people could order the last piece at the same time. You'll see both orders and can sort it out on WhatsApp.

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
src/orders.js       placing orders and changing their status
src/live.js         live stream setup, chat and the pinned piece
src/storage.js      photo and film uploads (Vercel Blob or local folder)
public/             the website itself
public/js/vendor/   Vercel's upload helper, prebuilt for the browser (npm run bundle-blob-client)
```

The eight starter pieces are there so the shop doesn't look empty at first. Edit or delete them once you've added your own.

Shops created before the switch to shillings and WhatsApp are updated automatically the first time the new version runs: starter pieces you haven't edited get shilling prices and brighter colours, homepage text you haven't changed gets the new wording, and old test orders are removed. Anything you changed yourself is left alone.
