# Muse Wear

An online clothing shop you run yourself. Customers browse, pick a size and pay by card. You add products, upload videos, and go live from your phone or laptop camera so people can watch you try things on and buy straight from the stream.

## What's in it

**For shoppers**
- Shop page with category filters, product pages with size picker, a bag that remembers what they added
- Card payments through Stripe Checkout (Apple Pay and Google Pay work too), with shipping address collected at checkout
- Videos page with all your uploads, and product pages show any videos linked to that item
- Live page: watch the stream, chat, and add the piece you're wearing to their bag without leaving
- A banner across the site whenever you're live

**For you (at `/admin`)**
- Overview with sales, orders waiting to ship and items running low
- Add, edit, hide and delete products, with photos, sizes and stock counts
- Upload videos (MP4, MOV or WebM up to 2 GB) and link them to a product
- Orders list with the customer's name, email and address, and a button to mark them shipped
- Go live: camera preview, switch between cameras, mute, pick which product viewers can buy, reply in chat, and an automatic replay saved to Videos when you finish

Stock goes down automatically when an order is paid, and checkout refuses anything that's sold out.

## Running it

You need Node.js 22.5 or newer.

```bash
npm install
cp .env.example .env    # then fill in the values, see below
npm start
```

Open http://localhost:3000 for the shop and http://localhost:3000/admin to manage it.

If you don't set `ADMIN_PASSWORD`, a temporary one is printed in the terminal each time the server starts.

## Taking real payments

Out of the box the shop runs in test mode: the whole checkout works but no one is charged, and there's a yellow note at the top of the site saying so. To switch to real payments:

1. Make an account at [stripe.com](https://stripe.com) and finish their business setup so payouts can reach your bank.
2. In the Stripe dashboard go to Developers > API keys and copy the **secret key** into `STRIPE_SECRET_KEY` in `.env`. Use the `sk_test_...` key first if you want to try it with Stripe's test cards (4242 4242 4242 4242, any future date, any CVC).
3. Set `PUBLIC_URL` to your real web address, e.g. `https://shop.example.com`.
4. Add a webhook in Stripe (Developers > Webhooks) pointing at `https://your-site/api/stripe/webhook`, listening for `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`. This makes sure orders get marked paid even if a customer closes the tab right after paying.
5. Restart the server.

Change `CURRENCY` if you don't sell in US dollars, and `SHIP_COUNTRIES` (comma separated, like `GB,IE,FR`) to the countries you ship to.

## Going live

1. Open `/admin` on the device you'll stream from and go to the **Go live** tab.
2. Turn the camera on, give the stream a title and press **Go live**.
3. Pick a product in "Product shown to viewers". Viewers see it over the video with an Add to bag button. Switch it as you try on different things.
4. Press **End stream** when you're done. If "Save a replay" was ticked, the recording uploads to Videos on its own.

A few things worth knowing:

- Browsers only allow the camera on `https://` sites (or `localhost`), so put the shop behind HTTPS before streaming for real.
- Video goes straight from your device to each viewer, so your **upload** speed decides how many people can watch smoothly. Roughly 1.2 Mbps per viewer: a 20 Mbps upload handles about 15 people well. Viewers are capped at 60. If you outgrow that, the next step is a streaming service such as Mux, Cloudflare Stream or LiveKit.
- Most viewers connect fine, but some strict office or mobile networks need a TURN relay. If people say the video won't load, sign up for one (Twilio, Metered and Cloudflare all offer them) and fill in the `TURN_` values in `.env`.
- Keep the admin tab open and in front while streaming. Phones pause the camera if you switch apps.

## Where things are stored

- `data/store.db` is the database (products, orders, videos). Back it up.
- `uploads/` holds photos and videos.

Both are left out of git on purpose. On a host with a temporary disk (Heroku, Render free tier and similar) they'll be wiped on every deploy, so use a server or plan with a persistent disk, like a small VPS, Railway with a volume, or Fly.io with a volume.

## Project layout

```
server.js          starts the web server
src/config.js      reads settings from .env
src/db.js          database tables and the starter products
src/routes.js      shop and admin API
src/payments.js    checkout, Stripe and marking orders paid
src/live.js        live stream connections, chat and pinned product
src/uploads.js     photo and video uploads
public/            the website (HTML, CSS and browser JavaScript)
```

The four starter products are there so the shop doesn't look empty the first time. Delete them from the admin once you've added your own.
